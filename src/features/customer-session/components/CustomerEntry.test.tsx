import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCustomerMenu,
  buildEmptyCustomerMenu,
  buildEnteredSession,
  MOCK_QR,
  MOCK_RESTAURANT_NAME,
} from '@/test/factories/customer';
import { mswServer } from '@/test/msw/node';
import { errorResponse } from '@/test/msw/respond';
import { CustomerEntry } from './CustomerEntry';
import { CustomerQueryProvider } from './CustomerQueryProvider';

/*
 * A customer is never navigated anywhere by a failed request, least of all to
 * a sign-in page. The customer app has no restaurant-user redirect at all
 * (`src/test/no-login-redirect.test.ts` proves no source references one);
 * these spies prove no client-side navigation happens either.
 */
const navigation = {
  pushState: vi.spyOn(window.history, 'pushState'),
  replaceState: vi.spyOn(window.history, 'replaceState'),
};
const startPath = window.location.pathname;

function expectNoNavigation() {
  expect(navigation.pushState).not.toHaveBeenCalled();
  expect(navigation.replaceState).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe(startPath);
}

type Counters = { entries: string[]; menus: number };

/**
 * Handlers for one test. The jsdom test environment has no cookie jar for the
 * HttpOnly cookie, so the backend's session behaviour is scripted per test.
 */
function backend({
  entry = () => HttpResponse.json(buildEnteredSession('1'), { status: 201 }),
  menu = () => HttpResponse.json(buildCustomerMenu()),
}: {
  entry?: () => Response;
  menu?: () => Response;
} = {}): Counters {
  const counters: Counters = { entries: [], menus: 0 };
  mswServer.use(
    http.post('*/customer/sessions', async ({ request }) => {
      const body = (await request.json()) as { qr_code: string };
      counters.entries.push(body.qr_code);
      return entry();
    }),
    http.get('*/customer/menu', () => {
      counters.menus += 1;
      return menu();
    }),
  );
  return counters;
}

function renderEntry(qrCode: string = MOCK_QR.table1) {
  return render(
    <CustomerQueryProvider>
      <CustomerEntry qrCode={qrCode} />
    </CustomerQueryProvider>,
  );
}

beforeEach(() => {
  navigation.pushState.mockClear();
  navigation.replaceState.mockClear();
});

describe('CustomerEntry', () => {
  it('shows a loading state, then the restaurant, table and menu', async () => {
    const counters = backend();
    renderEntry();

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME }),
    ).toBeInTheDocument();
    expect(screen.getByText('Table 1')).toBeInTheDocument();

    const mains = await screen.findByRole('region', { name: 'Mains' });
    expect(within(mains).getByText('Dal Makhani')).toBeInTheDocument();
    expect(within(mains).getByText('₹220.00')).toBeInTheDocument();
    expect(within(mains).getByText(/~\s*20 min/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Starters' })).toBeInTheDocument();
    const other = screen.getByRole('region', { name: 'Other dishes' });
    expect(within(other).getByText('Masala Chaas')).toBeInTheDocument();

    expect(counters.entries).toEqual([MOCK_QR.table1]);
    expect(counters.menus).toBe(1);
  });

  it('never offers S2+ actions: no cart, search, or add buttons', async () => {
    backend();
    renderEntry();
    await screen.findByRole('region', { name: 'Mains' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/cart/i)).toBeNull();
  });

  it('shows one generic state for an unknown or malformed QR code', async () => {
    const counters = backend({
      entry: () => errorResponse(404, 'not_found', 'The requested resource was not found.'),
    });
    renderEntry('not-a-qr');

    expect(
      await screen.findByRole('heading', { level: 1, name: "We couldn't find this table" }),
    ).toBeInTheDocument();
    expect(counters.menus).toBe(0);
  });

  it('shows Table Unavailable for an inactive table', async () => {
    backend({ entry: () => errorResponse(409, 'table_unavailable', 'Unavailable') });
    renderEntry(MOCK_QR.inactive);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Table unavailable' }),
    ).toBeInTheDocument();
  });

  it('points a customer with a session at another table back to their own table', async () => {
    backend({
      entry: () =>
        HttpResponse.json(
          {
            error: {
              code: 'customer_session_other_table',
              message: 'm',
              request_id: 'r',
              details: { table_number: '1' },
            },
          },
          { status: 409 },
        ),
    });
    renderEntry(MOCK_QR.table2);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your order is at Table 1' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Scan the QR code on that table/)).toBeInTheDocument();
  });

  it('asks the customer to wait when entry is rate limited', async () => {
    backend({
      entry: () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'm', request_id: 'r' } },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
    });
    renderEntry();

    expect(await screen.findByText(/Try again in 30 seconds/)).toBeInTheDocument();
  });

  it('shows a retryable error when entry fails, and retries', async () => {
    let fail = true;
    backend({
      entry: () =>
        fail
          ? errorResponse(500, 'internal_error', 'Internal error', 'req-entry-500')
          : HttpResponse.json(buildEnteredSession('1'), { status: 201 }),
    });
    renderEntry();

    expect(await screen.findByText("We couldn't open the menu")).toBeInTheDocument();
    expect(screen.getByText('Reference: req-entry-500')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Mains' })).toBeInTheDocument();
  });

  it('shows a retryable error when the menu fails to load', { timeout: 15_000 }, async () => {
    let fail = true;
    backend({
      menu: () =>
        fail
          ? errorResponse(503, 'service_unavailable', 'Unavailable', 'req-menu-503')
          : HttpResponse.json(buildCustomerMenu()),
    });
    renderEntry();

    // Server errors are retried twice with backoff before the error shows.
    expect(
      await screen.findByText("We couldn't load the menu", undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Mains' })).toBeInTheDocument();
  });

  it('shows an empty state when the restaurant has no available items', async () => {
    backend({ menu: () => HttpResponse.json(buildEmptyCustomerMenu()) });
    renderEntry();

    expect(await screen.findByText("The menu isn't available yet")).toBeInTheDocument();
  });

  it('treats a contract-breaking response as an error, not a menu', async () => {
    backend({ entry: () => HttpResponse.json({ data: {} }, { status: 201 }) });
    renderEntry();

    expect(await screen.findByText("We couldn't open the menu")).toBeInTheDocument();
  });

  it('re-enters once with the same QR code when the session ended (401), like a rescan', async () => {
    let menuCalls = 0;
    const counters = backend({
      menu: () => {
        menuCalls += 1;
        return menuCalls === 1
          ? errorResponse(401, 'customer_session_expired', 'Session ended')
          : HttpResponse.json(buildCustomerMenu());
      },
    });
    renderEntry();

    expect(await screen.findByRole('region', { name: 'Mains' })).toBeInTheDocument();
    expect(counters.entries).toEqual([MOCK_QR.table1, MOCK_QR.table1]);
    expectNoNavigation();
  });

  it('never sends a customer to /login, even when the session cannot be kept', async () => {
    backend({ menu: () => errorResponse(401, 'customer_session_expired', 'Session ended') });
    renderEntry();

    expect(await screen.findByText("We couldn't keep your table session")).toBeInTheDocument();
    expect(screen.getByText(/cookies are allowed/)).toBeInTheDocument();
    await waitFor(() => expectNoNavigation());
  });

  it('stores nothing about the customer session in browser storage', async () => {
    backend();
    renderEntry();
    await screen.findByRole('region', { name: 'Mains' });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
