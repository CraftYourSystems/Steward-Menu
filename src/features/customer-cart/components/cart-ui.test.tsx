import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCart,
  buildCartLine,
  MOCK_DISHES,
  MOCK_RESTAURANT_NAME,
} from '@/test/factories/customer';
import { endMockDeviceSession, useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { mswServer } from '@/test/msw/node';
import { errorResponse } from '@/test/msw/respond';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';

/*
 * The S2 cart in the UI, against the same contract-mirroring MSW handlers as
 * the mock API (one cookieless device session, since jsdom keeps no cookies).
 * Individual tests override a handler only to script a backend outcome.
 */

beforeEach(() => {
  useCookielessMockDevice();
});

afterEach(() => {
  vi.useRealTimers();
  mswServer.events.removeAllListeners();
});

async function menuLoaded() {
  await screen.findByRole('region', { name: 'Mains' });
  // The cart has loaded too once the Add buttons are enabled.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add Dal Makhani' })).toBeEnabled(),
  );
}

function cartSummary() {
  return screen.getByRole('region', { name: 'Your cart' });
}

describe('the cart on the menu', () => {
  it('adds a dish, then shows its quantity control and the server cart summary', async () => {
    renderCustomerPage();
    await menuLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    const control = await screen.findByRole('group', { name: 'Dal Makhani quantity' });
    expect(control).toHaveTextContent('1');
    expect(cartSummary()).toHaveTextContent('1 item · ₹220.00');
    expect(within(cartSummary()).getByRole('link', { name: 'View cart' })).toHaveAttribute(
      'href',
      '/t/mockQrTable01Active000/cart',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Increase Dal Makhani' }));
    await waitFor(() => expect(cartSummary()).toHaveTextContent('2 items · ₹440.00'));
    await userEvent.click(screen.getByRole('button', { name: 'Add Masala Chaas' }));
    await waitFor(() => expect(cartSummary()).toHaveTextContent('3 items · ₹500.00'));

    await userEvent.click(screen.getByRole('button', { name: 'Decrease Dal Makhani' }));
    await waitFor(() => expect(cartSummary()).toHaveTextContent('2 items · ₹280.00'));
    // Decreasing from 1 removes the line.
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Dal Makhani' }));
    expect(await screen.findByRole('button', { name: 'Add Dal Makhani' })).toBeInTheDocument();
    expect(cartSummary()).toHaveTextContent('1 item · ₹60.00');
  });

  it('shows exactly what the server returns, never its own arithmetic', async () => {
    mswServer.use(
      http.post('*/customer/cart/lines', () =>
        HttpResponse.json({
          data: {
            ...buildCart([buildCartLine(MOCK_DISHES.dal, 3)]).data,
            subtotal: { amount_minor: 12345, currency: 'INR' },
            item_count: 7,
          },
        }),
      ),
    );
    renderCustomerPage();
    await menuLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    expect(await screen.findByRole('group', { name: 'Dal Makhani quantity' })).toHaveTextContent(
      '3',
    );
    expect(cartSummary()).toHaveTextContent('7 items · ₹123.45');
  });

  it('disables every cart control while a change is being saved', async () => {
    let release: () => void = () => {};
    mswServer.use(
      http.post(
        '*/customer/cart/lines',
        () =>
          new Promise<Response>((resolve) => {
            release = () =>
              resolve(HttpResponse.json(buildCart([buildCartLine(MOCK_DISHES.dal, 1)])));
          }),
      ),
    );
    renderCustomerPage();
    await menuLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Paneer Tikka' })).toBeDisabled(),
    );
    act(() => release());
    expect(await screen.findByRole('group', { name: 'Dal Makhani quantity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Paneer Tikka' })).toBeEnabled();
  });

  it('explains an unavailable dish and reloads the menu', async () => {
    const requests = recordRequests();
    mswServer.use(
      http.post('*/customer/cart/lines', () =>
        errorResponse(422, 'item_unavailable', "This dish isn't available right now."),
      ),
    );
    renderCustomerPage();
    await menuLoaded();
    const menusBefore = requests.filter((r) => r.path.endsWith('/customer/menu')).length;

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't available right now/);
    await waitFor(() =>
      expect(requests.filter((r) => r.path.endsWith('/customer/menu')).length).toBe(
        menusBefore + 1,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains the per-dish limit', async () => {
    mswServer.use(
      http.post('*/customer/cart/lines', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'm',
              details: { fields: { quantity: [{ code: 'cart_line_quantity_max', message: 'm' }] } },
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderCustomerPage();
    await menuLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can order up to 20 of one dish.',
    );
  });

  it('asks the customer to wait when cart changes are rate limited', async () => {
    mswServer.use(
      http.post('*/customer/cart/lines', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'm', request_id: 'r' } },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );
    renderCustomerPage();
    await menuLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many changes at once. Please wait 30 seconds and try again.',
    );
    // Nothing is retried automatically.
    expect(screen.getByRole('button', { name: 'Add Dal Makhani' })).toBeEnabled();
  });

  it('when the session ended, says the cart was emptied and starts a new session', async () => {
    const requests = recordRequests();
    renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });

    endMockDeviceSession(); // 5 idle minutes later, as far as the backend is concerned
    await userEvent.click(screen.getByRole('button', { name: 'Add Masala Chaas' }));

    expect(await screen.findByRole('status', { name: 'Your session ended' })).toHaveTextContent(
      /your cart was emptied/,
    );
    expect(await screen.findByRole('button', { name: 'Add Dal Makhani' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your cart' })).toBeNull();
    expect(requests.filter((r) => r.path.endsWith('/customer/sessions'))).toHaveLength(2);
    expect(
      screen.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME }),
    ).toBeInTheDocument();
  });
});

describe('searching the menu by name', () => {
  it('filters dishes by name and says when nothing matches', async () => {
    renderCustomerPage();
    await menuLoaded();
    const search = screen.getByRole('searchbox', { name: 'Search dishes' });

    await userEvent.type(search, '  PANEER ');
    expect(screen.getByRole('button', { name: 'Add Paneer Tikka' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Dal Makhani' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mains' })).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, 'Starters'); // a category name is not searched
    expect(screen.getByText('No dishes match')).toBeInTheDocument();

    await userEvent.clear(search);
    expect(screen.getByRole('region', { name: 'Mains' })).toBeInTheDocument();
  });

  it('searches in the browser only: typing sends no request', async () => {
    const requests = recordRequests();
    renderCustomerPage();
    await menuLoaded();
    const before = requests.length;
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search dishes' }), 'dal');
    expect(requests).toHaveLength(before);
  });
});

describe('the cart page', () => {
  it('shows loading, then an empty cart with a way back to the menu', async () => {
    renderCustomerPage('cart');
    await screen.findByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME });
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the menu' })).toHaveAttribute(
      'href',
      '/t/mockQrTable01Active000',
    );
  });

  it('shows a loading state while the cart is fetched', async () => {
    mswServer.use(http.get('*/customer/cart', () => new Promise<Response>(() => {})));
    renderCustomerPage('cart');
    await screen.findByRole('heading', { name: 'Your cart' });
    expect(screen.getByText('Loading your cart…')).toBeInTheDocument();
  });

  it('lists the lines with server prices and totals, and changes and removes them', async () => {
    renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Masala Chaas' }));
    await screen.findByRole('group', { name: 'Masala Chaas quantity' });

    renderCustomerPage('cart');
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    expect(dal).toHaveTextContent('₹220.00 each');
    expect(within(dal).getByRole('group', { name: 'Dal Makhani quantity' })).toHaveTextContent('1');

    await userEvent.click(within(dal).getByRole('button', { name: 'Increase Dal Makhani' }));
    await waitFor(() => expect(dal).toHaveTextContent('₹440.00'));
    expect(screen.getAllByText('₹500.00').length).toBeGreaterThan(0); // subtotal

    await userEvent.click(screen.getByRole('button', { name: 'Remove Masala Chaas' }));
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: 'Masala Chaas' })).toBeNull(),
    );
    await userEvent.click(within(dal).getByRole('button', { name: 'Remove Dal Makhani' }));
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
  });

  it('marks an unavailable line, leaves it out of the subtotal, and only lets it go down', async () => {
    const cart = buildCart([
      buildCartLine(MOCK_DISHES.dal, 3, { id: 'line-dal', available: false }),
      buildCartLine(MOCK_DISHES.paneer, 1, { id: 'line-paneer' }),
    ]);
    const patches: unknown[] = [];
    mswServer.use(
      http.get('*/customer/cart', () => HttpResponse.json(cart)),
      http.patch('*/customer/cart/lines/:lineId', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json(
          buildCart([
            buildCartLine(MOCK_DISHES.dal, 2, { id: 'line-dal', available: false }),
            buildCartLine(MOCK_DISHES.paneer, 1, { id: 'line-paneer' }),
          ]),
        );
      }),
    );
    renderCustomerPage('cart');

    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    expect(dal).toHaveTextContent(/Unavailable — this dish can't be ordered right now/);
    expect(dal).toHaveTextContent('Not included: ₹660.00');
    expect(screen.getByText('Unavailable dishes are not included.')).toBeInTheDocument();
    expect(within(dal).getByRole('button', { name: 'Increase Dal Makhani' })).toBeDisabled();
    expect(within(dal).getByRole('button', { name: 'Remove Dal Makhani' })).toBeEnabled();

    await userEvent.click(within(dal).getByRole('button', { name: 'Decrease Dal Makhani' }));
    await waitFor(() => expect(patches).toEqual([{ quantity: 2 }]));
    await waitFor(() =>
      expect(within(dal).getByRole('group', { name: 'Dal Makhani quantity' })).toHaveTextContent(
        '2',
      ),
    );
  });

  it('explains a line that is no longer in the cart and reloads the cart', async () => {
    const requests = recordRequests();
    mswServer.use(
      http.get('*/customer/cart', () =>
        HttpResponse.json(buildCart([buildCartLine(MOCK_DISHES.dal, 1, { id: 'line-gone' })])),
      ),
      http.delete('*/customer/cart/lines/:lineId', () =>
        errorResponse(404, 'not_found', 'The requested resource was not found.'),
      ),
    );
    renderCustomerPage('cart');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Dal Makhani' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That item isn't in your cart any more.",
    );
    await waitFor(() =>
      expect(requests.filter((r) => r.path.endsWith('/customer/cart')).length).toBe(2),
    );
  });

  it('shows a retryable error when the cart fails to load', { timeout: 15_000 }, async () => {
    let fail = true;
    mswServer.use(
      http.get('*/customer/cart', () =>
        fail
          ? errorResponse(503, 'service_unavailable', 'Unavailable', 'req-cart-503')
          : HttpResponse.json(buildCart()),
      ),
    );
    renderCustomerPage('cart');
    expect(
      await screen.findByText("We couldn't load your cart", undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reference: req-cart-503')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
  });

  it('when the session ended, says so on the cart page and shows the new empty cart', async () => {
    const menu = renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });
    menu.unmount();

    renderCustomerPage('cart');
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    endMockDeviceSession(); // the cart page stays open past the 5 idle minutes
    await userEvent.click(within(dal).getByRole('button', { name: 'Increase Dal Makhani' }));

    expect(await screen.findByRole('status', { name: 'Your session ended' })).toHaveTextContent(
      /your cart was emptied/,
    );
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
  });

  it('a fresh visit after the session ended simply starts a new, empty cart', async () => {
    const menu = renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });
    menu.unmount();

    endMockDeviceSession();
    renderCustomerPage('cart');
    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
  });
});

describe('cart requests', () => {
  it('send only the dish and quantity, with credentials and no CSRF token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const requests = recordRequests();
    renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });

    const write = requests.find((r) => r.method === 'POST' && r.path.endsWith('/cart/lines'));
    expect(write?.headers.get('X-CSRF-Token')).toBeNull();
    expect(requests.some((r) => r.path.includes('/auth/'))).toBe(false);
    const call = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/customer/cart/lines'));
    expect(call?.[1]?.credentials).toBe('include');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ menu_item_id: 'item-dal', quantity: 1 });
    fetchSpy.mockRestore();
  });

  it('are never sent while the customer is idle: no polling, no heartbeat (F1-04)', async () => {
    const requests = recordRequests();
    renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });
    const before = requests.length;

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(requests).toHaveLength(before);
  });

  it('keep nothing in browser storage', async () => {
    renderCustomerPage();
    await menuLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani' }));
    await screen.findByRole('group', { name: 'Dal Makhani quantity' });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
