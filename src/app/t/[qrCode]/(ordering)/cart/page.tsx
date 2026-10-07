import type { Metadata } from 'next';
import { CustomerCartPage } from '@/features/customer-cart/components/CustomerCartPage';

export const metadata: Metadata = { title: 'Cart' };

/** The server-side cart (route map `/t/[qrCode]/cart`; F-01 S2). */
export default function CustomerCartRoute() {
  return <CustomerCartPage />;
}
