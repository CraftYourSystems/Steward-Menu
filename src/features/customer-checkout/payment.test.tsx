import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerQueryProvider } from '@/features/customer-session/components/CustomerQueryProvider';
import { CustomerSessionBoundary } from '@/features/customer-session/components/CustomerSessionBoundary';
import { ApiError } from '@/lib/api/errors';
import { leaveForPayment } from '@/lib/navigation';
import {
  buildCheckout,
  buildEnteredSession,
  MOCK_DISHES,
  MOCK_QR,
  type WireAttemptStatus,
} from '@/test/factories/customer';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { selectMockScenario } from '@/test/msw/mock-scenario';
import { mswServer } from '@/test/msw/node';
import { routerPush, setPathname, setSearchParams } from '@/test/next-navigation';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';
import { CustomerCheckoutPage } from './components/CustomerCheckoutPage';
import { PaymentReturnPage } from './components/PaymentReturnPage';
import { paymentProblemFor } from './payment-problem';
import { pollDelay } from './polling';

vi.mock('@/lib/navigation', () => ({ leaveForPayment: vi.fn() }));

/*
 * Payment initiation and the payment return page (F-01 S4; technical design §11
 * to §14), against the contract-mirroring MSW handlers. The page never decides a
 * payment's outcome: it shows what the backend reports, polls with backoff, and
 * never shows a payment as paid.
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

/** A session with a reviewed checkout (2 Dal, 1 Chaas: total ₹525.00). Returns its ID. */
async function reviewed(): Promise<string> {
  await call('/customer/sessions', { qr_code: MOCK_QR.table1 });
  await call('/customer/cart/lines', { menu_item_id: MOCK_DISHES.dal.id, quantity: 2 });
  await call('/customer/cart/lines', { menu_item_id: MOCK_DISHES.chaas.id, quantity: 1 });
  await call('/customer/details', { name: 'Asha Rao', mobile: '9876543210' }, 'PUT');
  const review = await call('/customer/checkout/review');
  return ((await review.json()) as { data: { checkout_id: string } }).data.checkout_id;
}

/** Pay through the mock backend. Returns the mock gateway page URL. */
async function paid(checkoutId: string): Promise<string> {
  const response = await call(`/customer/checkout/${checkoutId}/payments`);
  return ((await response.json()) as { data: { redirect_url: string } }).data.redirect_url;
}

/** The customer's choice on the mock gateway page. Only a status poll applies it. */
async function choose(gatewayUrl: string, action: 'fail' | 'cancel' | 'pending') {
  await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `action=${action}`,
    redirect: 'manual',
  });
}

function conflict(code: string, details?: Record<string, unknown>) {
  return HttpResponse.json(
    { error: { code, message: 'm', request_id: 'req-1', ...(details ? { details } : {}) } },
    { status: 409 },
  );
}

/** Scripted reads for the return page: the checkout and its status. */
function paymentBackend(attempts: WireAttemptStatus[]) {
  const checkout = buildCheckout({ lines: [{ dish: MOCK_DISHES.dal, quantity: 1 }], attempts });
  mswServer.use(
    http.post('*/customer/sessions', () =>
      HttpResponse.json(buildEnteredSession('1', undefined, 'payment'), { status: 200 }),
    ),
    http.get('*/customer/checkout', () => HttpResponse.json(checkout)),
    http.get('*/customer/checkout/:id/status', () =>
      HttpResponse.json({
        data: {
          checkout_id: 'checkout-1',
          status: 'payment_started',
          payment: checkout.data.payment,
        },
      }),
    ),
  );
}

async function openReturnPage() {
  renderCustomerPage('payment');
  await screen.findByRole('heading', { name: 'Payment' });
}

// ── Mapping and backoff ─────────────────────────────────────────────────────────

describe('payment problems', () => {
  const api = (code: string, details?: Record<string, unknown>, status = 409) =>
    new ApiError({ kind: status === 502 ? 'server' : 'conflict', status, code, details });

  it.each([
    [{ reasons: ['item_unavailable'], unavailable_item_ids: ['x'] }, { kind: 'item_unavailable' }],
    [{ unavailable_item_ids: ['x'] }, { kind: 'item_unavailable' }], // Review's S3 payload
    [{ reasons: ['price_changed'] }, { kind: 'review_again', reason: 'price_changed' }],
    [{ reasons: ['tax_changed'] }, { kind: 'review_again', reason: 'tax_changed' }],
    [{ reasons: ['cart_changed'] }, { kind: 'review_again', reason: 'cart_changed' }],
    [{ reasons: ['table_unavailable'] }, { kind: 'table_unavailable' }],
    [{ reasons: ['price_changed', 'item_unavailable'] }, { kind: 'item_unavailable' }],
    [{ reasons: ['item_unavailable', 'table_unavailable'] }, { kind: 'table_unavailable' }],
  ])('routes checkout_revalidation_required %j', (details, expected) => {
    expect(paymentProblemFor(api('checkout_revalidation_required', details))).toEqual(expected);
  });

  it.each([
    ['cart_locked', { kind: 'cart_locked' }],
    ['payment_still_confirming', { kind: 'still_confirming' }],
    ['payment_retry_limit', { kind: 'retry_limit' }],
    ['restaurant_configuration_incomplete', { kind: 'configuration' }],
  ])('maps %s', (code, expected) => {
    expect(paymentProblemFor(api(code))).toEqual(expected);
  });

  it('maps payment_gateway_unavailable, 401 and 429', () => {
    expect(paymentProblemFor(api('payment_gateway_unavailable', undefined, 502))).toEqual({
      kind: 'gateway_unavailable',
    });
    expect(paymentProblemFor(new ApiError({ kind: 'unauthorized', status: 401 }))).toEqual({
      kind: 'session_ended',
    });
    expect(
      paymentProblemFor(new ApiError({ kind: 'rate_limited', status: 429, retryAfterSeconds: 9 })),
    ).toEqual({ kind: 'rate_limited', retryAfterSeconds: 9 });
  });
});

describe('status polling backoff', () => {
  it('starts at 2 seconds, grows by half each time and stops growing at 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(pollDelay)).toEqual([
      2000, 3000, 4500, 6750, 10125, 15188, 22781, 30000, 30000, 30000,
    ]);
  });
});

// ── Pay on the review page ──────────────────────────────────────────────────────

describe('Pay', () => {
  async function openReviewed() {
    await reviewed();
    renderCustomerPage('checkout');
    return screen.findByRole('button', { name: 'Pay' });
  }

  it('sends the browser to the gateway with no amount, token or storage', async () => {
    const requests = recordRequests();
    const pay = await openReviewed();
    await userEvent.click(pay);

    await waitFor(() => expect(leaveForPayment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(leaveForPayment).mock.calls[0]![0]).toMatch(/\/mock-gateway\/attempt-\d+$/);
    const payment = requests.find((r) => r.path.endsWith('/payments'))!;
    expect(payment.method).toBe('POST');
    expect(payment.headers.get('X-CSRF-Token')).toBeNull();
    expect(payment.headers.get('Content-Type')).toBeNull(); // no body: never an amount
    expect(screen.getByRole('button', { name: 'Opening payment…' })).toBeDisabled();
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual([0, 0]);
  });

  it('a dish that became unavailable sends the customer to the cart', async () => {
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        conflict('checkout_revalidation_required', {
          reasons: ['item_unavailable'],
          unavailable_item_ids: [MOCK_DISHES.dal.id],
        }),
      ),
    );
    await userEvent.click(await openReviewed());
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(`${BASE}/cart?changed=availability`),
    );
    expect(leaveForPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['price_changed', 'Some prices changed since you reviewed your order. Please review it again.'],
    ['tax_changed', 'The tax rate changed since you reviewed your order. Please review it again.'],
    [
      'table_unavailable',
      "This table isn't taking orders right now. Please ask a member of staff.",
    ],
  ])('%s: explained, and the order is reviewed again', async (reason, message) => {
    let superseded = false;
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () => {
        superseded = true;
        return conflict('checkout_revalidation_required', {
          reasons: [reason],
          unavailable_item_ids: [],
        });
      }),
      http.get('*/customer/checkout', () =>
        superseded
          ? HttpResponse.json({ error: { code: 'not_found', message: 'm' } }, { status: 404 })
          : HttpResponse.json(buildCheckout({ lines: [{ dish: MOCK_DISHES.dal, quantity: 1 }] })),
      ),
    );
    await userEvent.click(await openReviewed());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Review order' })).toBeEnabled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('missing payment configuration is explained without a workaround', async () => {
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        conflict('restaurant_configuration_incomplete', { missing: ['payment'] }),
      ),
    );
    await userEvent.click(await openReviewed());
    expect(
      await screen.findByText(
        "This restaurant can't take orders right now. Please ask a member of staff.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeEnabled();
  });

  it.each([
    ['payment_gateway_unavailable', 502],
    ['payment_still_confirming', 409],
  ])('%s hands over to the payment page', async (code, status) => {
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        HttpResponse.json({ error: { code, message: 'm' } }, { status }),
      ),
    );
    await userEvent.click(await openReviewed());
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
  });
});

// ── The return page ─────────────────────────────────────────────────────────────

describe('the payment return page', () => {
  it('never trusts the URL: a "success" query still shows Confirming', async () => {
    setSearchParams('code=PAYMENT_SUCCESS&status=paid&checkout=forged');
    paymentBackend(['awaiting_payment']);
    await openReturnPage();
    expect(await screen.findByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    expect(screen.queryByText(/paid|success|order placed/i)).toBeNull();
  });

  it('polls status with backoff and shows Payment not completed once the backend says so', async () => {
    const checkoutId = await reviewed();
    const gateway = await paid(checkoutId);
    const requests = recordRequests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    expect(await screen.findByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    const polls = () => requests.filter((r) => r.path.endsWith('/status')).length;

    await act(() => vi.advanceTimersByTimeAsync(1_900));
    expect(polls()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(polls()).toBe(1); // 2 s
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(polls()).toBe(2); // + 3 s
    await choose(gateway, 'fail'); // the customer's choice alone changes nothing
    expect(screen.getByRole('heading', { name: 'Confirming payment…' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(4_500));
    expect(polls()).toBe(3); // + 4.5 s: the backend now reports the attempt failed

    expect(
      await screen.findByRole('heading', { name: 'Payment not completed' }),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(polls()).toBe(3); // polling stops once nothing awaits
  });

  it('mounts fresh buttons when the state changes, so none animates between variants', async () => {
    const checkoutId = await reviewed();
    const gateway = await paid(checkoutId);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    const before = await screen.findByRole('button', { name: 'Go back to payment' });
    await choose(gateway, 'fail');
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    const after = await screen.findByRole('button', { name: 'Retry payment' });
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });

  it('caps the polling interval at 30 seconds', async () => {
    paymentBackend(['awaiting_payment']);
    const requests = recordRequests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    await screen.findByRole('heading', { name: 'Confirming payment…' });
    const times: number[] = [];
    let seen = 0;
    for (let elapsed = 0; elapsed < 200_000; elapsed += 250) {
      await act(() => vi.advanceTimersByTimeAsync(250));
      const count = requests.filter((r) => r.path.endsWith('/status')).length;
      if (count > seen) {
        times.push(elapsed + 250);
        seen = count;
      }
    }
    const gaps = times.map((time, index) => time - (times[index - 1] ?? 0));
    expect(gaps.slice(0, 3)).toEqual([2000, 3000, 4500]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(30_250);
    expect(gaps.at(-1)).toBeGreaterThanOrEqual(29_750);
  });

  it('Payment not completed offers Retry payment (same checkout) and Review / change order', async () => {
    const checkoutId = await reviewed();
    await choose(await paid(checkoutId), 'cancel');
    await fetch(`${API}/customer/checkout/${checkoutId}/status`); // the backend learns it
    await openReturnPage();

    const panel = await screen.findByRole('alert');
    expect(
      within(panel).getByRole('heading', { name: 'Payment not completed' }),
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent('₹525.00');
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry payment' }));
    await waitFor(() => expect(leaveForPayment).toHaveBeenCalledTimes(1));
  });

  it('Review / change order releases the checkout and returns to the cart', async () => {
    const checkoutId = await reviewed();
    await choose(await paid(checkoutId), 'fail');
    await fetch(`${API}/customer/checkout/${checkoutId}/status`);
    await openReturnPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Review / change order' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`${BASE}/cart`));
    // The cart unlocked with its lines.
    const add = await call('/customer/cart/lines', {
      menu_item_id: MOCK_DISHES.paneer.id,
      quantity: 1,
    });
    expect(add.status).toBe(200);
  });

  it('Review / change order while an attempt is unconfirmed shows Still confirming', async () => {
    const checkoutId = await reviewed();
    await paid(checkoutId);
    await openReturnPage();
    await screen.findByRole('heading', { name: 'Confirming payment…' });

    await userEvent.click(screen.getByRole('button', { name: 'Review / change order' }));
    expect(
      await screen.findByRole('heading', { name: 'Still confirming your previous payment…' }),
    ).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('Go back to payment returns to the same gateway page while it awaits', async () => {
    const checkoutId = await reviewed();
    const gateway = await paid(checkoutId);
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Go back to payment' }));
    await waitFor(() => expect(leaveForPayment).toHaveBeenCalledWith(gateway));
  });

  it('a retry the gateway cannot start shows the gateway error', async () => {
    paymentBackend(['failed']);
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        HttpResponse.json(
          { error: { code: 'payment_gateway_unavailable', message: 'm' } },
          { status: 502 },
        ),
      ),
    );
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry payment' }));
    expect(
      await screen.findByRole('heading', { name: "We couldn't start the payment" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Review / change order' })).toBeEnabled();
  });

  it('a gateway error on Pay is handed to the payment page and shown there', async () => {
    await reviewed();
    selectMockScenario('gateway_error');
    // One query client for both pages, as under the app's root layout; navigating
    // re-renders from the root, as the App Router does.
    function App() {
      const [path, setPath] = useState(`${BASE}/checkout`);
      useEffect(() => {
        routerPush.mockImplementation((href) => {
          setPathname(href);
          setPath(href);
        });
        return () => {
          routerPush.mockReset();
        };
      }, []);
      setPathname(path);
      return (
        <CustomerQueryProvider>
          <CustomerSessionBoundary qrCode={MOCK_QR.table1}>
            {path === RETURN ? <PaymentReturnPage /> : <CustomerCheckoutPage />}
          </CustomerSessionBoundary>
        </CustomerQueryProvider>
      );
    }
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    expect(
      await screen.findByRole('heading', { name: "We couldn't start the payment" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry payment' })).toBeEnabled();
  });

  it('a dish that became unavailable leaves only Review / change order', async () => {
    paymentBackend(['abandoned']);
    let released = false;
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        conflict('checkout_revalidation_required', {
          reasons: ['item_unavailable'],
          unavailable_item_ids: [MOCK_DISHES.dal.id],
        }),
      ),
      http.post('*/customer/checkout/:id/release', () => {
        released = true;
        return HttpResponse.json({
          data: { checkout_id: 'checkout-1', status: 'released', payment: null },
        });
      }),
    );
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry payment' }));
    expect(
      await screen.findByRole('heading', { name: 'A dish in your order is no longer available' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Review / change order' }));
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(`${BASE}/cart?changed=availability`),
    );
    expect(released).toBe(true);
  });

  it('after five attempts only Review / change order is offered', async () => {
    paymentBackend(['failed', 'failed', 'abandoned', 'failed', 'failed']);
    await openReturnPage();
    expect(
      await screen.findByRole('heading', { name: "This order can't be paid again" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Review / change order' })).toBeEnabled();
  });

  it('payment_retry_limit from the backend leaves only Review / change order', async () => {
    paymentBackend(['failed']);
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () => conflict('payment_retry_limit')),
    );
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry payment' }));
    expect(
      await screen.findByRole('heading', { name: "This order can't be paid again" }),
    ).toBeInTheDocument();
  });

  it('missing payment configuration on retry is explained', async () => {
    paymentBackend(['failed']);
    mswServer.use(
      http.post('*/customer/checkout/:id/payments', () =>
        conflict('restaurant_configuration_incomplete', { missing: ['payment'] }),
      ),
    );
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry payment' }));
    expect(
      await screen.findByRole('heading', { name: "We can't take this payment" }),
    ).toBeInTheDocument();
  });

  it('with no payment in progress it says so and links back', async () => {
    await call('/customer/sessions', { qr_code: MOCK_QR.table1 });
    await openReturnPage();
    expect(
      await screen.findByRole('heading', { name: 'No payment in progress' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your cart' })).toHaveAttribute(
      'href',
      `${BASE}/cart`,
    );
  });
});

// ── Session stage and the locked cart ───────────────────────────────────────────

describe('the payment stage', () => {
  it('a payment-stage session on another page is sent to the payment page', async () => {
    const requests = recordRequests();
    paymentBackend(['awaiting_payment']);
    renderCustomerPage('cart');
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
    expect(screen.queryByRole('heading', { name: /cart/i })).toBeNull();
    expect(requests.some((r) => r.path.endsWith('/customer/cart'))).toBe(false);
  });

  it('cart_locked on a cart write sends the customer to the payment page', async () => {
    const checkoutId = await reviewed();
    await paid(checkoutId);
    // A page opened before payment started still believes the cart is open.
    mswServer.use(
      http.post('*/customer/sessions', () =>
        HttpResponse.json(buildEnteredSession('1'), { status: 200 }),
      ),
    );
    renderCustomerPage('cart');
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    await userEvent.click(within(dal).getByRole('button', { name: /increase/i }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(RETURN));
  });
});

// ── The S4 mock scenarios, through the contract-mirroring mock backend ──────────

describe('payment mock scenarios', () => {
  it.each([
    ['price_changed', 'Some prices changed since you reviewed your order. Please review it again.'],
    ['tax_changed', 'The tax rate changed since you reviewed your order. Please review it again.'],
    [
      'payment_config_missing',
      "This restaurant can't take orders right now. Please ask a member of staff.",
    ],
  ] as const)('%s on Pay', async (scenario, message) => {
    await reviewed();
    renderCustomerPage('checkout');
    const pay = await screen.findByRole('button', { name: 'Pay' });
    selectMockScenario(scenario);
    await userEvent.click(pay);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(leaveForPayment).not.toHaveBeenCalled();
    if (scenario !== 'payment_config_missing') {
      expect(await screen.findByRole('button', { name: 'Review order' })).toBeEnabled();
    }
  });

  it('gateway_error fails the attempt and the payment page offers a retry', async () => {
    const checkoutId = await reviewed();
    selectMockScenario('gateway_error');
    expect((await call(`/customer/checkout/${checkoutId}/payments`)).status).toBe(502);
    selectMockScenario(null);
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry payment' }));
    await waitFor(() => expect(leaveForPayment).toHaveBeenCalledTimes(1));
  });

  it('attempt_failed: the next status poll reports the attempt failed', async () => {
    await paid(await reviewed());
    selectMockScenario('attempt_failed');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openReturnPage();
    await screen.findByRole('heading', { name: 'Confirming payment…' });
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(
      await screen.findByRole('heading', { name: 'Payment not completed' }),
    ).toBeInTheDocument();
  });

  it('still_confirming: retry and release wait', async () => {
    await paid(await reviewed());
    selectMockScenario('still_confirming');
    await openReturnPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Go back to payment' }));
    expect(
      await screen.findByRole('heading', { name: 'Still confirming your previous payment…' }),
    ).toBeInTheDocument();
    expect(leaveForPayment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Review / change order' }));
    expect(routerPush).not.toHaveBeenCalled();
  });
});
