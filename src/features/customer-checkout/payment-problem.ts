import { ApiError, userMessageFor } from '@/lib/api/errors';

/**
 * What a failed Pay, retry or release means (F-01 technical design §11 to §14;
 * S4). Branches on the error `code` and `details.reasons`, never on the message.
 */
export type PaymentProblem =
  /** A dish became unavailable (`reasons` has `item_unavailable`). */
  | { kind: 'item_unavailable' }
  /** The price, tax rate or order changed since Review: review again. */
  | { kind: 'review_again'; reason: 'price_changed' | 'tax_changed' | 'cart_changed' }
  /** The table stopped taking orders: talk to staff. */
  | { kind: 'table_unavailable' }
  /** The restaurant cannot take payments (no payment configuration). Nothing the customer can fix. */
  | { kind: 'configuration' }
  /** An earlier attempt is still unconfirmed: keep waiting. */
  | { kind: 'still_confirming' }
  /** The checkout had every allowed attempt: review or change the order. */
  | { kind: 'retry_limit' }
  /** The gateway could not start the payment; the attempt failed. */
  | { kind: 'gateway_unavailable' }
  /** Payment is in progress, so the cart cannot change. */
  | { kind: 'cart_locked' }
  /** The checkout is not in a state that allows this (for example already released). */
  | { kind: 'conflict' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'session_ended' }
  | { kind: 'error'; message: string; requestId: string | undefined };

const REVIEW_AGAIN = ['price_changed', 'tax_changed', 'cart_changed'] as const;

function revalidationProblem(details: Record<string, unknown> | undefined): PaymentProblem {
  const raw = details?.reasons;
  // Review answers without `reasons`: its only reason is an unavailable dish.
  const reasons = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [];
  if (reasons.includes('table_unavailable')) return { kind: 'table_unavailable' };
  if (reasons.length === 0 || reasons.includes('item_unavailable')) {
    return { kind: 'item_unavailable' };
  }
  const reason = REVIEW_AGAIN.find((candidate) => reasons.includes(candidate)) ?? 'cart_changed';
  return { kind: 'review_again', reason };
}

export function paymentProblemFor(error: unknown): PaymentProblem {
  if (!(error instanceof ApiError)) {
    return { kind: 'error', message: userMessageFor(error), requestId: undefined };
  }
  if (error.kind === 'unauthorized') return { kind: 'session_ended' };
  if (error.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
  }
  switch (error.code) {
    case 'checkout_revalidation_required':
      return revalidationProblem(error.details);
    case 'table_unavailable':
      return { kind: 'table_unavailable' };
    case 'restaurant_configuration_incomplete':
      return { kind: 'configuration' };
    case 'payment_still_confirming':
      return { kind: 'still_confirming' };
    case 'payment_retry_limit':
      return { kind: 'retry_limit' };
    case 'payment_gateway_unavailable':
      return { kind: 'gateway_unavailable' };
    case 'cart_locked':
      return { kind: 'cart_locked' };
    case 'conflict':
      return { kind: 'conflict' };
    default:
      return { kind: 'error', message: userMessageFor(error), requestId: error.requestId };
  }
}

/** A 409 `cart_locked` from any cart, details or Review write (S4, F1-05). */
export function isCartLocked(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'cart_locked';
}

export const TALK_TO_STAFF =
  "This table isn't taking orders right now. Please ask a member of staff.";
export const CANT_TAKE_ORDERS =
  "This restaurant can't take orders right now. Please ask a member of staff.";

export function rateLimitedMessage(retryAfterSeconds: number | undefined): string {
  return retryAfterSeconds
    ? `Too many attempts. Please wait ${retryAfterSeconds} seconds and try again.`
    : 'Too many attempts. Please wait a moment and try again.';
}
