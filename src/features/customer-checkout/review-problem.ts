import { ApiError, userMessageFor } from '@/lib/api/errors';

/**
 * What a failed Review means (F-01 technical design §9, §10). Branches on the
 * error `code`, never on the message.
 */
export type ReviewProblem =
  /** A cart dish became unavailable: back to the cart to remove it. */
  | { kind: 'revalidation' }
  | { kind: 'cart_empty' }
  | { kind: 'details_required' }
  /** The restaurant cannot price orders (no tax rate). Nothing the customer can fix. */
  | { kind: 'configuration' }
  | { kind: 'table_unavailable' }
  /** Payment is in progress (S4): the order cannot be reviewed again until it is released. */
  | { kind: 'cart_locked' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'session_ended' }
  | { kind: 'error'; message: string; requestId: string | undefined };

export function reviewProblemFor(error: unknown): ReviewProblem {
  if (!(error instanceof ApiError)) {
    return { kind: 'error', message: userMessageFor(error), requestId: undefined };
  }
  if (error.kind === 'unauthorized') return { kind: 'session_ended' };
  if (error.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
  }
  switch (error.code) {
    case 'checkout_revalidation_required':
      return { kind: 'revalidation' };
    case 'cart_empty':
      return { kind: 'cart_empty' };
    case 'customer_details_required':
      return { kind: 'details_required' };
    case 'restaurant_configuration_incomplete':
      return { kind: 'configuration' };
    case 'table_unavailable':
      return { kind: 'table_unavailable' };
    case 'cart_locked':
      return { kind: 'cart_locked' };
    default:
      return { kind: 'error', message: userMessageFor(error), requestId: error.requestId };
  }
}
