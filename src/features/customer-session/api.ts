import { customerSend } from '@/lib/api/customer';
import type { RequestOptions } from '@/lib/api/request';
import { EnteredSessionSchema, type EnteredSession } from './schemas';

/**
 * QR entry: starts this device's customer session, or resumes it for the same
 * table (F1-01, F1-03, F1-32). The backend sets or refreshes the cookie.
 */
export function enterSession(
  qrCode: string,
  options: RequestOptions = {},
): Promise<EnteredSession> {
  return customerSend(
    '/customer/sessions',
    'POST',
    EnteredSessionSchema,
    { json: { qr_code: qrCode } },
    options,
  );
}
