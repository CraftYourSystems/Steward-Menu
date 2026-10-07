import type { Metadata } from 'next';
import { CustomerMenuPage } from '@/features/customer-menu/components/CustomerMenuPage';

export const metadata: Metadata = { title: 'Menu' };

/** QR entry and the menu (route map R1; F-01 S1, S2). */
export default function CustomerMenuRoute() {
  return <CustomerMenuPage />;
}
