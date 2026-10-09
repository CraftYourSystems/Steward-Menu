import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveForPayment } from '@/lib/navigation';
import { setRealtimeSocketFactory } from '@/lib/realtime/use-customer-realtime';
import { FakeSocket } from '@/test/fake-socket';
import { buildEnteredSession, MOCK_DISHES, MOCK_QR } from '@/test/factories/customer';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { selectMockScenario } from '@/test/msw/mock-scenario';
import { mswServer } from '@/test/msw/node';
import { routerPush } from '@/test/next-navigation';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';

vi.mock('@/lib/navigation', () => ({ leaveForPayment: vi.fn() }));

/*
 * Verified payment → order placement (F-01 S5) on the customer side, against
 * the contract-mirroring mock backend: a placed order goes on to its order page
 * (S6), the missed-webhook recovery, paid-but-not-placed (F1-22), and the
 * session after placement.
 */

const API = 'http://api.test';
const BASE = `/t/${MOCK_QR.table1}`;
const RETURN = `${BASE}/payment/return`;
const ORDER_PAGE = new RegExp(`^${BASE}/orders/[0-9a-f-]{36}$`);

beforeEach(() => {
  useCookielessMockDevice();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(leaveForPayment).mockClear();
  mswServer.events.removeAllListeners();
});

async function call(path: string, body?: unknown, method = 'POST') {
  return fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** QR → cart (2 Dal "less oil", 1 Chaas) → details → Review → Pay. Returns the gateway URL. */
async function paying(): Promise<string> {
  await call('/customer/sessions', { qr_code: MOCK_QR.table1 });
  await call('/customer/cart/lines', {
    menu_item_id: MOCK_DISHES.dal.id,
    quantity: 2,
    special_instructions: 'less oil',
  });
  await call('/customer/cart/lines', { menu_item_id: MOCK_DISHES.chaas.id, quantity: 1 });
  await call('/customer/details', { name: 'Asha Rao', mobile: '9876543210' }, 'PUT');
  const review = await call('/customer/checkout/review');
  const { data } = (await review.json()) as { data: { checkout_id: string } };
  const pay = await call(`/customer/checkout/${data.checkout_id}/payments`);
  return ((await pay.json()) as { data: { redirect_url: string } }).data.redirect_url;
}

async function choose(gatewayUrl: string, action: 'pay' | 'pay_no_webhook' | 'pending' | 'fail') {
  await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `action=${action}`,
    redirect: 'manual',
  });
}

async function openReturnPage() {
  renderCustomerPage('payment');
  await screen.findByRole('heading', { name: 'Payment' });
}

/** Where the customer was sent last: the placed order's page. */
function sentToOrderPage() {
  return waitFor(() =>
    expect(routerPush.mock.calls.flat().some((href) => ORDER_PAGE.test(href))).toBe(true),
  );
}

describe('Order placed (P1, S6)', () => {
  it('the return page takes a placed order to its order page', async () => {
    await choose(await paying(), 'pay'); // the signed webhook places the order
    renderCustomerPage('payment'); // the gateway's return, already placed

    await sentToOrderPage();
    expect(screen.queryByText(/payment not completed/i)).toBeNull();
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual([0, 0]);
  });

  it('a missed webhook is recovered by polling, then the order page follows', async () => {
    await choose(await paying(), 'pay_no_webhook');
    const requests = recordRequests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    expect(await screen.findByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(requests.some((r) => r.path.endsWith('/status'))).toBe(true);
    await sentToOrderPage();
  });

  it('a same-table rescan of a placed session resumes its order page', async () => {
    await choose(await paying(), 'pay');
    renderCustomerPage('menu');
    await sentToOrderPage();
    expect(routerPush).not.toHaveBeenCalledWith(RETURN);
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });
});

describe('order.placed in realtime (S7, DoD 16)', () => {
  let sockets: FakeSocket[];

  beforeEach(() => {
    sockets = [];
    setRealtimeSocketFactory((url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    });
  });

  function statusReads(requests: { path: string }[]) {
    return requests.filter((r) => r.path.endsWith('/status')).length;
  }

  it('the paying session hears order.placed and goes on at once, before any poll', async () => {
    const gateway = await paying();
    await choose(gateway, 'pending'); // the customer is back; the payment is unresolved
    const requests = recordRequests();
    await openReturnPage();
    expect(await screen.findByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0]!;
    expect(socket.url).toBe('ws://api.test/ws/customer');
    socket.open(); // resync: one immediate status read, still awaiting
    await waitFor(() => expect(statusReads(requests)).toBe(1));

    await choose(gateway, 'pay'); // the verified payment places the order meanwhile
    socket.message({ event_id: 'e1', type: 'order.placed', order_id: 'o', occurred_at: 'now' });
    socket.message({ event_id: 'e1', type: 'order.placed', order_id: 'o', occurred_at: 'now' });
    await waitFor(
      () => expect(routerPush.mock.calls.flat().some((h) => /\/orders\//.test(h))).toBe(true),
      {
        timeout: 1_500, // the first poll would wait 2 s
      },
    );
    expect(statusReads(requests)).toBe(2); // the resync and the event; no scheduled poll
  });

  it('without the socket, polling still finds the placement', async () => {
    const gateway = await paying();
    await choose(gateway, 'pending');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    await waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.serverClose(1006); // the socket never comes up
    await choose(gateway, 'pay');
    expect(routerPush).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    await waitFor(() =>
      expect(routerPush.mock.calls.flat().some((h) => /\/orders\//.test(h))).toBe(true),
    );
  });

  it('opens no socket once nothing is awaited', async () => {
    const gateway = await paying();
    await choose(gateway, 'fail');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(
      await screen.findByRole('heading', { name: 'Payment not completed' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(sockets.every((socket) => socket.closedWith !== null)).toBe(true));
  });
});

describe('paid but not placed (F1-22)', () => {
  it('shows the refund notice and no order, token or confirmation', async () => {
    const gateway = await paying();
    selectMockScenario('paid_not_placed');
    await choose(gateway, 'pay');
    await openReturnPage();

    expect(
      await screen.findByRole('heading', {
        name: 'Payment received, but your order could not be placed',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The restaurant will handle your refund.');
    expect(screen.queryByText(/order placed/i)).toBeNull();
    expect(screen.queryByText(/token/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /retry|pay/i })).toBeNull();
  });

  it('a payment-issue session is kept on the payment page', async () => {
    const gateway = await paying();
    selectMockScenario('paid_not_placed');
    await choose(gateway, 'pay');
    renderCustomerPage('cart');
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
  });
});

describe('after placement', () => {
  /** A page opened before placement: its session still believes the cart is open. */
  function staleCartSession() {
    mswServer.use(
      http.post('*/customer/sessions', () =>
        HttpResponse.json(buildEnteredSession('1'), { status: 200 }),
      ),
    );
  }

  it('order_already_placed on a cart write sends the customer to the confirmation', async () => {
    await choose(await paying(), 'pay');
    staleCartSession();
    renderCustomerPage('cart');
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani (less oil)' });
    await userEvent.click(within(dal).getByRole('button', { name: /increase/i }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
  });

  it('order_already_placed on a details write does the same', async () => {
    await choose(await paying(), 'pay');
    staleCartSession();
    renderCustomerPage('details');
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to review' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
  });

  it('paying again never makes a second order: the same order page follows', async () => {
    await choose(await paying(), 'pay');
    const again = await call('/customer/checkout/checkout-0/payments');
    expect(again.status).toBe(404);
    const { data } = (await (await call('/customer/checkout', undefined, 'GET')).json()) as {
      data: { checkout_id: string; order: { token_number: string } };
    };
    const second = await call(`/customer/checkout/${data.checkout_id}/payments`);
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
      'order_already_placed',
    );
    expect(data.order.token_number).toBe('1');
    renderCustomerPage('payment');
    await sentToOrderPage();
  });

  it('Pay on a stale review page after placement routes to the confirmation', async () => {
    await call('/customer/sessions', { qr_code: MOCK_QR.table1 });
    await call('/customer/cart/lines', { menu_item_id: MOCK_DISHES.chaas.id, quantity: 1 });
    await call('/customer/details', { name: 'Asha Rao', mobile: '9876543210' }, 'PUT');
    await call('/customer/checkout/review');
    renderCustomerPage('checkout');
    const pay = await screen.findByRole('button', { name: 'Pay' });
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        HttpResponse.json(
          { error: { code: 'order_already_placed', message: 'm' } },
          { status: 409 },
        ),
      ),
    );
    await userEvent.click(pay);
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
    expect(leaveForPayment).not.toHaveBeenCalled();
  });
});
