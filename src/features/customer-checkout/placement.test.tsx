import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveForPayment } from '@/lib/navigation';
import { buildEnteredSession, MOCK_DISHES, MOCK_QR } from '@/test/factories/customer';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { selectMockScenario } from '@/test/msw/mock-scenario';
import { mswServer } from '@/test/msw/node';
import { routerPush } from '@/test/next-navigation';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';

vi.mock('@/lib/navigation', () => ({ leaveForPayment: vi.fn() }));

/*
 * Verified payment → order placement (F-01 S5) on the customer side, against
 * the contract-mirroring mock backend: the in-place Order placed confirmation
 * (P1), the missed-webhook recovery, paid-but-not-placed (F1-22), and the
 * session after placement. The page never links to an order page (S6).
 */

const API = 'http://api.test';
const BASE = `/t/${MOCK_QR.table1}`;
const RETURN = `${BASE}/payment/return`;

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

async function choose(gatewayUrl: string, action: 'pay' | 'pay_no_webhook' | 'pending') {
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

function confirmation() {
  return screen.findByRole('status', { name: 'Order placed' });
}

describe('Order placed (P1)', () => {
  it('shows the token, table, items and total in place, with no order page link', async () => {
    await choose(await paying(), 'pay'); // the signed webhook places the order
    await openReturnPage();

    const placed = await confirmation();
    expect(within(placed).getByLabelText('Token 1')).toHaveTextContent('1');
    expect(placed).toHaveTextContent('Table 1');
    expect(placed).toHaveTextContent(/Placed at/);
    const items = within(placed).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('2 × Dal Makhani');
    expect(items[0]).toHaveTextContent('Note: less oil');
    expect(items[0]).toHaveTextContent('₹440.00');
    expect(items[1]).toHaveTextContent('1 × Masala Chaas');
    expect(placed).toHaveTextContent('Total paid₹525.00');
    expect(screen.queryByRole('link', { name: /order/i })).toBeNull();
    expect(document.querySelector('a[href*="/orders/"]')).toBeNull();
    expect(routerPush.mock.calls.flat().some((href) => href.includes('/orders/'))).toBe(false);
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual([0, 0]);
  });

  it('a missed webhook is recovered by polling, then the same confirmation shows', async () => {
    await choose(await paying(), 'pay_no_webhook');
    const requests = recordRequests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    expect(await screen.findByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    expect(screen.queryByText('Order placed')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(requests.some((r) => r.path.endsWith('/status'))).toBe(true);
    expect(within(await confirmation()).getByLabelText('Token 1')).toBeInTheDocument();
  });

  it('a same-table rescan of a placed session resumes the confirmation', async () => {
    await choose(await paying(), 'pay');
    renderCustomerPage('menu');
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
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

  it('paying again never makes a second order: the confirmation stays the same', async () => {
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
    await openReturnPage();
    expect(within(await confirmation()).getByLabelText('Token 1')).toBeInTheDocument();
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
