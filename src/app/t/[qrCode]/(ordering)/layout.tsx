import type { ReactNode } from 'react';
import { CustomerSessionBoundary } from '@/features/customer-session/components/CustomerSessionBoundary';

/**
 * The ordering pages of the QR context `/t/[qrCode]` (route map R1): menu, cart,
 * details, review and payment return. `(ordering)` is a route group: it adds
 * nothing to the URL, and keeps the order page (`/t/[qrCode]/orders/[orderRef]`,
 * F-01 S6) **outside** this boundary, because opening an SMS link on another
 * device must never enter a table session there.
 *
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
