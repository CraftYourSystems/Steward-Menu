import type { Metadata } from 'next';
import { CustomerOrderPage } from '@/features/customer-order/components/CustomerOrderPage';

export const metadata: Metadata = { title: 'Your order', referrer: 'no-referrer' };

/**
 * The customer's order page (F-01 S6; route map): reached after placement, from
 * a same-table rescan of a placed session, or from the SMS link
 * (`…/orders/{orderRef}#k={secret}`, possibly on another device). It sits
 * outside the `(ordering)` session boundary, so it never enters a table session.
 * Everything is fetched in the browser.
 */
export default async function CustomerOrderRoute({
  params,
}: {
  params: Promise<{ qrCode: string; orderRef: string }>;
}) {
  const { qrCode, orderRef } = await params;
  return <CustomerOrderPage qrCode={qrCode} orderRef={orderRef} />;
}
