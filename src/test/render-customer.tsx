import { render } from '@testing-library/react';
import { CustomerCartPage } from '@/features/customer-cart/components/CustomerCartPage';
import { CustomerMenuPage } from '@/features/customer-menu/components/CustomerMenuPage';
import { CustomerQueryProvider } from '@/features/customer-session/components/CustomerQueryProvider';
import { CustomerSessionBoundary } from '@/features/customer-session/components/CustomerSessionBoundary';
import { MOCK_QR } from './factories/customer';
import { mswServer } from './msw/node';

/** Renders a customer page as its route does: query client, session boundary, page. */
export function renderCustomerPage(
  page: 'menu' | 'cart' = 'menu',
  qrCode: string = MOCK_QR.table1,
) {
  return render(
    <CustomerQueryProvider>
      <CustomerSessionBoundary qrCode={qrCode}>
        {page === 'menu' ? <CustomerMenuPage /> : <CustomerCartPage />}
      </CustomerSessionBoundary>
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
