import { render } from '@testing-library/react';
import { CustomerCartPage } from '@/features/customer-cart/components/CustomerCartPage';
import { CustomerCheckoutPage } from '@/features/customer-checkout/components/CustomerCheckoutPage';
import { PaymentReturnPage } from '@/features/customer-checkout/components/PaymentReturnPage';
import { CustomerDetailsPage } from '@/features/customer-details/components/CustomerDetailsPage';
import { CustomerMenuPage } from '@/features/customer-menu/components/CustomerMenuPage';
import { CustomerOrderPage } from '@/features/customer-order/components/CustomerOrderPage';
import { CustomerQueryProvider } from '@/features/customer-session/components/CustomerQueryProvider';
import { CustomerSessionBoundary } from '@/features/customer-session/components/CustomerSessionBoundary';
import { MOCK_QR } from './factories/customer';
import { mswServer } from './msw/node';
import { setPathname } from './next-navigation';

export type CustomerPage = 'menu' | 'cart' | 'details' | 'checkout' | 'payment';

const PAGES: Record<CustomerPage, React.ReactElement> = {
  menu: <CustomerMenuPage />,
  cart: <CustomerCartPage />,
  details: <CustomerDetailsPage />,
  checkout: <CustomerCheckoutPage />,
  payment: <PaymentReturnPage />,
};

const PATHS: Record<CustomerPage, string> = {
  menu: '',
  cart: '/cart',
  details: '/details',
  checkout: '/checkout',
  payment: '/payment/return',
};

/** Renders a customer page as its route does: query client, session boundary, page. */
export function renderCustomerPage(page: CustomerPage = 'menu', qrCode: string = MOCK_QR.table1) {
  setPathname(`/t/${qrCode}${PATHS[page]}`);
  return render(
    <CustomerQueryProvider>
      <CustomerSessionBoundary qrCode={qrCode}>{PAGES[page]}</CustomerSessionBoundary>
    </CustomerQueryProvider>,
  );
}

/**
 * Renders the order page (S6) as its route does: outside the session boundary.
 * `fragment` is the URL fragment an SMS link carries (`#k=…`).
 */
export function renderOrderPage(
  orderRef: string,
  { fragment = '', qrCode = MOCK_QR.table1 }: { fragment?: string; qrCode?: string } = {},
) {
  const path = `/t/${qrCode}/orders/${orderRef}`;
  setPathname(path);
  window.history.replaceState(null, '', `${path}${fragment}`);
  return render(
    <CustomerQueryProvider>
      <CustomerOrderPage qrCode={qrCode} orderRef={orderRef} />
    </CustomerQueryProvider>,
  );
}

export type RecordedRequest = { method: string; path: string; headers: Headers };

/** Records every request MSW sees, from now until the test ends. */
export function recordRequests(): RecordedRequest[] {
  const seen: RecordedRequest[] = [];
  mswServer.events.on('request:start', ({ request }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      headers: request.headers,
    });
  });
  return seen;
}
