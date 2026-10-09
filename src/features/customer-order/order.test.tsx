import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_DISHES, MOCK_QR } from '@/test/factories/customer';
import { FakeSocket } from '@/test/fake-socket';
import {
  advanceMockOrder,
  expireMockOrderLink,
  mockOrderLink,
  useAnotherMockDevice,
  useCookielessMockDevice,
} from '@/test/msw/handlers/customer';
import { mswServer } from '@/test/msw/node';
import { routerPush } from '@/test/next-navigation';
import { recordRequests, renderOrderPage } from '@/test/render-customer';
import { setRealtimeSocketFactory } from './use-order-realtime';

/*
 * The customer's order page (F-01 S6) against the contract-mirroring mock
 * backend: access by the placing session or an SMS link's grant, one generic
 * answer for every refusal, live status driven by refetches, reconnect and
 * resync, and the session's end at Completed.
 */

const API = 'http://api.test';
let sockets: FakeSocket[];

beforeEach(() => {
  useCookielessMockDevice();
  sockets = [];
  setRealtimeSocketFactory((url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });
});

afterEach(() => {
  mswServer.events.removeAllListeners();
});

async function call(path: string, body?: unknown, method = 'POST') {
  return fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** QR → cart (2 Dal "less oil", 1 Chaas) → details → Review → Pay → webhook. */
async function placeOrder(): Promise<string> {
  await call('/customer/sessions', { qr_code: MOCK_QR.table1 });
  await call('/customer/cart/lines', {
    menu_item_id: MOCK_DISHES.dal.id,
    quantity: 2,
    special_instructions: 'less oil',
  });
  await call('/customer/cart/lines', { menu_item_id: MOCK_DISHES.chaas.id, quantity: 1 });
  await call('/customer/details', { name: 'Asha Rao', mobile: '9876543210' }, 'PUT');
  const review = (await (await call('/customer/checkout/review')).json()) as {
    data: { checkout_id: string };
  };
  const pay = (await (
    await call(`/customer/checkout/${review.data.checkout_id}/payments`)
  ).json()) as {
    data: { redirect_url: string };
  };
  await fetch(pay.data.redirect_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=pay',
    redirect: 'manual',
  });
  const checkout = (await (await call('/customer/checkout', undefined, 'GET')).json()) as {
    data: { order: { order_ref: string } };
  };
  return checkout.data.order.order_ref;
}

function currentStatus() {
  return screen.getByRole('status', { name: 'Current status' });
}

/** The socket the page opened, once open (the server accepted it). */
async function openSocket(): Promise<FakeSocket> {
  await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
  const socket = sockets.at(-1)!;
  socket.open();
  return socket;
}

function statusEvent(orderRef: string, status: string, eventId: string) {
  return {
    event_id: eventId,
    type: 'order.status_changed',
    occurred_at: new Date().toISOString(),
    order_id: orderRef,
    order_status: status,
  };
}

function orderReads(requests: { method: string; path: string }[]) {
  return requests.filter((r) => r.method === 'GET' && r.path.includes('/customer/orders/')).length;
}

describe('the placing session', () => {
  it('reads its order: token, table, items, amounts and status, nothing personal', async () => {
    const ref = await placeOrder();
    renderOrderPage(ref);

    expect(await screen.findByLabelText('Token 1')).toHaveTextContent('1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Steward Test Kitchen');
    expect(screen.getByText('Table 1')).toBeInTheDocument();
    expect(currentStatus()).toHaveTextContent('Order received');
    const steps = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Order received (done)'),
      expect.stringContaining('Being prepared (not yet)'),
      expect.stringContaining('Ready (not yet)'),
      expect.stringContaining('Completed (not yet)'),
    ]);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    const items = screen.getByRole('region', { name: 'Items' });
    expect(items).toHaveTextContent('2 × Dal Makhani');
    expect(items).toHaveTextContent('Note: less oil');
    expect(items).toHaveTextContent('1 × Masala Chaas');
    expect(screen.getByRole('region', { name: 'Amounts' })).toHaveTextContent('Total paid₹525.00');
    expect(screen.getByText(/Status as of/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Asha|98765|\+91/);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('a realtime event refetches; duplicates and other orders are ignored', async () => {
    const ref = await placeOrder();
    const requests = recordRequests();
    renderOrderPage(ref);
    await screen.findByLabelText('Token 1');
    const socket = await openSocket();
    expect(socket.url).toBe('ws://api.test/ws/customer');
    expect(await screen.findByText('Live updates on')).toBeInTheDocument();
    await waitFor(() => expect(orderReads(requests)).toBe(2)); // first load + resync on open

    advanceMockOrder(ref);
    socket.message(statusEvent(ref, 'cooking', 'e1'));
    await waitFor(() => expect(currentStatus()).toHaveTextContent('Being prepared'));
    expect(orderReads(requests)).toBe(3);

    socket.message(statusEvent(ref, 'cooking', 'e1')); // a duplicate delivery
    socket.message(statusEvent('00000000-0000-4000-8000-999999999999', 'ready_to_serve', 'e2'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(orderReads(requests)).toBe(3);
  });

  it('a status from an event alone is never shown: the API decides', async () => {
    const ref = await placeOrder();
    renderOrderPage(ref);
    await screen.findByLabelText('Token 1');
    const socket = await openSocket();
    socket.message(statusEvent(ref, 'ready_to_serve', 'e-lie')); // the backend still says placed
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(currentStatus()).toHaveTextContent('Order received');
  });

  it('after a dropped connection it shows Reconnecting, then resyncs on reconnect', async () => {
    const ref = await placeOrder();
    renderOrderPage(ref);
    await screen.findByLabelText('Token 1');
    const first = await openSocket();
    first.serverClose(1006);
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument();

    advanceMockOrder(ref); // missed while disconnected: never replayed
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2_000 });
    sockets[1]!.open();
    await waitFor(() => expect(currentStatus()).toHaveTextContent('Being prepared'));
    expect(screen.getByText('Live updates on')).toBeInTheDocument();
  });

  it('at Completed its access ends: the order stays on screen, marked Completed', async () => {
    const ref = await placeOrder();
    renderOrderPage(ref);
    await screen.findByLabelText('Token 1');
    const socket = await openSocket();
    for (const [index, status] of ['cooking', 'ready_to_serve'].entries()) {
      advanceMockOrder(ref);
      socket.message(statusEvent(ref, status, `e${index}`));
    }
    await waitFor(() => expect(currentStatus()).toHaveTextContent('Ready'));

    advanceMockOrder(ref); // Completed ends the session (F1-37)
    socket.message(statusEvent(ref, 'completed', 'e-done'));
    socket.serverClose(4440);
    await waitFor(() => expect(currentStatus()).toHaveTextContent('Completed'));
    expect(screen.getByLabelText('Token 1')).toBeInTheDocument();
    expect(screen.queryByText("This order link isn't available")).toBeNull();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
    expect((await call(`/customer/orders/${ref}`, undefined, 'GET')).status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(sockets).toHaveLength(1); // no reconnect after 4440
  });
});

describe('the SMS link', () => {
  it('opens the order on another device and leaves no secret behind', async () => {
    const ref = await placeOrder();
    const link = mockOrderLink(ref)!;
    const fragment = link.slice(link.indexOf('#'));
    const secret = fragment.slice('#k='.length);
    useAnotherMockDevice();
    const requests = recordRequests();
    renderOrderPage(ref, { fragment });

    expect(await screen.findByLabelText('Token 1')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(secret);
    expect(requests.some((r) => r.method === 'POST' && r.path === '/customer/order-access')).toBe(
      true,
    );
    expect(requests.every((r) => !r.path.includes(secret))).toBe(true);
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual([0, 0]);
    expect(requests.some((r) => r.path === '/customer/sessions')).toBe(false); // no table session
  });

  it('keeps reading the order after Completed (the grant has its own lifetime)', async () => {
    const ref = await placeOrder();
    const link = mockOrderLink(ref)!;
    useAnotherMockDevice();
    renderOrderPage(ref, { fragment: link.slice(link.indexOf('#')) });
    await screen.findByLabelText('Token 1');
    advanceMockOrder(ref);
    advanceMockOrder(ref);
    advanceMockOrder(ref);
    const read = await call(`/customer/orders/${ref}`, undefined, 'GET');
    expect(read.status).toBe(200);
    expect(((await read.json()) as { data: { status: string } }).data.status).toBe('completed');
  });

  it.each([
    ['no link at all', () => ''],
    ['a wrong secret', () => '#k=wrongSecretValue'],
    ['a malformed fragment', () => '#k=%%%'],
  ])('%s shows one generic answer', async (_, fragment) => {
    const ref = await placeOrder();
    useAnotherMockDevice();
    renderOrderPage(ref, { fragment: fragment() });
    expect(
      await screen.findByRole('heading', { name: "This order link isn't available" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Token/)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('an expired link shows the same generic answer', async () => {
    const ref = await placeOrder();
    const link = mockOrderLink(ref)!;
    expireMockOrderLink(ref);
    useAnotherMockDevice();
    renderOrderPage(ref, { fragment: link.slice(link.indexOf('#')) });
    expect(
      await screen.findByRole('heading', { name: "This order link isn't available" }),
    ).toBeInTheDocument();
  });

  it('a link opened in a tab already on the page (fragment only) is redeemed too', async () => {
    const ref = await placeOrder();
    const link = mockOrderLink(ref)!;
    useAnotherMockDevice();
    renderOrderPage(ref);
    await screen.findByRole('heading', { name: "This order link isn't available" });

    window.location.hash = link.slice(link.indexOf('#') + 1);
    expect(await screen.findByLabelText('Token 1')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});
