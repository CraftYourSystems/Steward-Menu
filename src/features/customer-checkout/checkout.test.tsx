import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCheckout, MOCK_DISHES, MOCK_QR } from '@/test/factories/customer';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { mswServer } from '@/test/msw/node';
import { routerPush } from '@/test/next-navigation';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';
import { CheckoutSchema } from './schemas';

/*
 * The review step (F-01 S3, technical design §9 to §11), against the
 * contract-mirroring MSW handlers (500 basis points, half up). The page shows
 * the backend's amounts exactly and never creates a checkout on load.
 */

const API = 'http://api.test';

beforeEach(() => {
  useCookielessMockDevice();
});

afterEach(() => {
  vi.useRealTimers();
  mswServer.events.removeAllListeners();
});

async function post(path: string, body: unknown, method = 'POST') {
  return fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A session with a cart (2 Dal "less oil", 1 Masala Chaas) and, optionally, details. */
async function readyToReview({ details = true } = {}) {
  await post('/customer/sessions', { qr_code: MOCK_QR.table1 });
  await post('/customer/cart/lines', {
    menu_item_id: MOCK_DISHES.dal.id,
    quantity: 2,
    special_instructions: 'less oil',
  });
  await post('/customer/cart/lines', { menu_item_id: MOCK_DISHES.chaas.id, quantity: 1 });
  if (details) {
    await post('/customer/details', { name: 'Asha Rao', mobile: '98765 43210' }, 'PUT');
  }
}

async function openReview() {
  renderCustomerPage('checkout');
  await screen.findByRole('heading', { name: 'Review your order' });
}

function amounts() {
  return screen.getByRole('region', { name: 'Amounts' });
}

describe('the review page', () => {
  it('creates nothing on load: it offers Review when there is no open checkout', async () => {
    const requests = recordRequests();
    await readyToReview();
    await openReview();
    expect(await screen.findByRole('button', { name: 'Review order' })).toBeEnabled();
    expect(requests.filter((r) => r.path.endsWith('/checkout/review'))).toHaveLength(0);
  });

  it('reviews on request and shows the server’s snapshot and amounts exactly', async () => {
    await readyToReview();
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));

    const order = await screen.findByRole('region', { name: 'Your order' });
    const lines = within(order).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('2 × Dal Makhani');
    expect(lines[0]).toHaveTextContent('₹220.00 each');
    expect(lines[0]).toHaveTextContent('Note: less oil');
    expect(lines[0]).toHaveTextContent('₹440.00');
    expect(lines[1]).toHaveTextContent('1 × Masala Chaas');
    // 500.00 subtotal; 5 % tax 25.00; total 525.00 (from the server).
    expect(amounts()).toHaveTextContent('Subtotal₹500.00');
    expect(amounts()).toHaveTextContent('Tax₹25.00');
    expect(amounts()).toHaveTextContent('Total₹525.00');
    const details = screen.getByRole('region', { name: 'Your details' });
    expect(details).toHaveTextContent('Asha Rao');
    expect(details).toHaveTextContent('+91 98765 43210');
    expect(details).toHaveTextContent('Table1');
  });

  it('never calculates: odd server amounts are shown as given', async () => {
    const odd = buildCheckout({ lines: [{ dish: MOCK_DISHES.dal, quantity: 1 }] });
    odd.data.amounts.subtotal.amount_minor = 11111;
    odd.data.amounts.taxes[0]!.amount.amount_minor = 22;
    odd.data.amounts.total.amount_minor = 99999;
    mswServer.use(http.get('*/customer/checkout', () => HttpResponse.json(odd)));
    await readyToReview();
    await openReview();
    await screen.findByRole('region', { name: 'Amounts' });
    expect(amounts()).toHaveTextContent('Subtotal₹111.11');
    expect(amounts()).toHaveTextContent('Tax₹0.22');
    expect(amounts()).toHaveTextContent('Total₹999.99');
  });

  it('shows an open checkout again after a reload, without reviewing again', async () => {
    const requests = recordRequests();
    await readyToReview();
    const first = renderCustomerPage('checkout');
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await screen.findByRole('region', { name: 'Amounts' });
    first.unmount();

    await openReview();
    expect(await screen.findByRole('region', { name: 'Amounts' })).toHaveTextContent('₹525.00');
    expect(requests.filter((r) => r.path.endsWith('/checkout/review'))).toHaveLength(1);
  });

  it('a cart change and a details change each send the customer back to Review', async () => {
    await readyToReview();
    const page = renderCustomerPage('checkout');
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await screen.findByRole('region', { name: 'Amounts' });
    page.unmount();

    await post('/customer/cart/lines', { menu_item_id: MOCK_DISHES.paneer.id, quantity: 1 });
    const afterCart = renderCustomerPage('checkout');
    expect(await screen.findByRole('button', { name: 'Review order' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review order' }));
    expect(await screen.findByRole('region', { name: 'Amounts' })).toHaveTextContent('₹786.45');
    afterCart.unmount();

    await post('/customer/details', { name: 'Asha R', mobile: '9876543210' }, 'PUT');
    await openReview();
    expect(await screen.findByRole('button', { name: 'Review order' })).toBeInTheDocument();
  });

  it('sends the customer back to the cart when a dish became unavailable', async () => {
    mswServer.use(
      http.post('*/customer/checkout/review', () =>
        HttpResponse.json(
          {
            error: {
              code: 'checkout_revalidation_required',
              message: 'm',
              details: { unavailable_item_ids: [MOCK_DISHES.dal.id] },
            },
          },
          { status: 409 },
        ),
      ),
    );
    await readyToReview();
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        '/t/mockQrTable01Active000/cart?changed=availability',
      ),
    );
  });

  it('sends the customer to give details, or to the cart, when Review needs them', async () => {
    await readyToReview({ details: false });
    const page = renderCustomerPage('checkout');
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith('/t/mockQrTable01Active000/details'),
    );
    page.unmount();

    mswServer.use(
      http.post('*/customer/checkout/review', () =>
        HttpResponse.json({ error: { code: 'cart_empty', message: 'm' } }, { status: 409 }),
      ),
    );
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/t/mockQrTable01Active000/cart'));
  });

  it.each([
    [
      'restaurant_configuration_incomplete',
      "This restaurant can't take orders right now. Please ask a member of staff.",
    ],
    [
      'table_unavailable',
      "This table isn't taking orders right now. Please ask a member of staff.",
    ],
  ])('explains %s without inventing a workaround', async (code, message) => {
    mswServer.use(
      http.post('*/customer/checkout/review', () =>
        HttpResponse.json(
          { error: { code, message: 'm', details: { missing: ['tax_rate'] } } },
          { status: 409 },
        ),
      ),
    );
    await readyToReview();
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/tax|configur/i);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('asks the customer to wait when Review is rate limited', async () => {
    mswServer.use(
      http.post('*/customer/checkout/review', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'm' } },
          { status: 429, headers: { 'Retry-After': '20' } },
        ),
      ),
    );
    await readyToReview();
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait 20 seconds and try again.',
    );
  });

  it('has no payment step, no CSRF token, no storage and no idle requests', async () => {
    const requests = recordRequests();
    await readyToReview();
    await openReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Review order' }));
    await screen.findByRole('region', { name: 'Amounts' });

    expect(screen.queryByRole('button', { name: /pay|place|phonepe/i })).toBeNull();
    expect(screen.queryByText(/phonepe|payment/i)).toBeNull();
    const reviewRequest = requests.find((r) => r.path.endsWith('/checkout/review'));
    expect(reviewRequest?.headers.get('X-CSRF-Token')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    const before = requests.length;
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(requests).toHaveLength(before);
    expect(routerPush.mock.calls.flat().some((href) => href.includes('login'))).toBe(false);
  });
});

describe('checkout contract', () => {
  it('parses the review payload and rejects other statuses or currencies', () => {
    const wire = buildCheckout({
      lines: [{ dish: MOCK_DISHES.dal, quantity: 2, specialInstructions: 'less oil' }],
    });
    expect(CheckoutSchema.parse(wire)).toEqual({
      checkoutId: 'checkout-1',
      customerName: 'Asha Rao',
      mobileDisplay: '+91 98765 43210',
      tableNumber: '1',
      lines: [
        {
          name: 'Dal Makhani',
          unitPriceMinor: 22000,
          quantity: 2,
          specialInstructions: 'less oil',
          lineTotalMinor: 44000,
        },
      ],
      subtotalMinor: 44000,
      taxes: [{ label: 'Tax', amountMinor: 2200 }],
      totalMinor: 46200,
    });
    expect(
      CheckoutSchema.safeParse({ data: { ...wire.data, status: 'payment_started' } }).success,
    ).toBe(false);
    const usd = structuredClone(wire);
    (usd.data.amounts.total as { currency: string }).currency = 'USD';
    expect(CheckoutSchema.safeParse(usd).success).toBe(false);
  });
});
