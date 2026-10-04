import type { Metadata } from 'next';
import { PaymentReturnPage } from '@/features/customer-checkout/components/PaymentReturnPage';

export const metadata: Metadata = { title: 'Payment' };

/**
 * Where the payment gateway returns the customer (F-01 S4; technical design §14).
 * The gateway's query parameters are never read: the payment state comes from
 * the backend only.
 */
export default function PaymentReturnRoute() {
  return <PaymentReturnPage />;
}
