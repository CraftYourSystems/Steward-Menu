import type { Metadata } from 'next';
import { CustomerDetailsPage } from '@/features/customer-details/components/CustomerDetailsPage';

export const metadata: Metadata = { title: 'Your details' };

/** Name + mobile (route map `/t/[qrCode]/details`; F-01 S3). */
export default function CustomerDetailsRoute() {
  return <CustomerDetailsPage />;
}
