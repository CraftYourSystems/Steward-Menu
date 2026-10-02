import { ApiError } from '@/lib/api/errors';

/**
 * Why QR entry did not open the menu (F-01 technical design §1). Branches on
 * the error `code`, never on the message.
 */
export type EntryProblem =
  /** Unknown or malformed QR: one generic state that reveals nothing (F-04 §13). */
  | { kind: 'invalid' }
  /** A real but inactive table (F-04 §7). */
  | { kind: 'unavailable' }
  /** This device's session is at another table (F1-03); only its own number is known. */
  | { kind: 'other_table'; tableNumber: string }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'error'; error: unknown };

export function entryProblemFor(error: unknown): EntryProblem {
  if (!(error instanceof ApiError)) return { kind: 'error', error };
  if (error.kind === 'not_found') return { kind: 'invalid' };
  if (error.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error.kind === 'conflict' && error.code === 'table_unavailable') {
    return { kind: 'unavailable' };
  }
  if (error.kind === 'conflict' && error.code === 'customer_session_other_table') {
    const tableNumber = error.details?.table_number;
    if (typeof tableNumber === 'string' && tableNumber) return { kind: 'other_table', tableNumber };
  }
  return { kind: 'error', error };
}
