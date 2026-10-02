import type { Metadata } from 'next';
import { CustomerEntry } from '@/features/customer-session/components/CustomerEntry';

export const metadata: Metadata = { title: 'Menu' };

/**
 * QR entry (route map R1, F-01 S1). The QR code is opaque; the backend
 * resolves and validates it. Nothing customer-specific is fetched during
 * server rendering: the page runs entirely in the browser.
 */
export default async function CustomerQrEntryPage({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  return <CustomerEntry qrCode={qrCode} />;
}
