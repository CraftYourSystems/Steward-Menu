import type { ReactNode } from 'react';
import { CustomerSessionBoundary } from '@/features/customer-session/components/CustomerSessionBoundary';

/**
 * Every customer page lives under the QR context `/t/[qrCode]` (route map R1).
 * The QR code is opaque; the backend resolves and validates it. Entering it
 * starts or resumes this device's customer session, so a direct load or reload
 * of any page here keeps the same session and cart. Nothing customer-specific
 * is fetched during server rendering: the session runs entirely in the browser.
 */
export default async function CustomerQrLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  return <CustomerSessionBoundary qrCode={qrCode}>{children}</CustomerSessionBoundary>;
}
