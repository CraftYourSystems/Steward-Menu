import type { Metadata } from 'next';
import { CustomerCheckoutPage } from '@/features/customer-checkout/components/CustomerCheckoutPage';

export const metadata: Metadata = { title: 'Review your order' };

/** The review step (route map `/t/[qrCode]/checkout`; F-01 S3). No payment yet (S4). */
export default function CustomerCheckoutRoute() {
  return <CustomerCheckoutPage />;
}
