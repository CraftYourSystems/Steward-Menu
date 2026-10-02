import { ApiError, userMessageFor } from '@/lib/api/errors';
import { CART_LINE_MAX_QUANTITY, SPECIAL_INSTRUCTIONS_MAX_LENGTH } from './schemas';

/**
 * What a failed cart change means for the customer (F-01 technical design §5,
 * §33). Branches on the error `code`, never on the message.
 */
export type CartProblem =
  /** The dish is not available any more: the menu and cart are reloaded. */
  | { kind: 'unavailable' }
  /** The line or dish no longer exists for this session: the menu and cart are reloaded. */
  | { kind: 'gone' }
  /** The line would hold more than the cap (TD-10). */
  | { kind: 'too_many' }
  /** Special instructions longer than the cap after normalization (TD-16). */
  | { kind: 'instructions_too_long' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  /** The session ended (401): handled by the session boundary. */
  | { kind: 'session_ended' }
  | { kind: 'error'; message: string; requestId: string | undefined };

export function cartProblemFor(error: unknown): CartProblem {
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') return { kind: 'session_ended' };
    if (error.code === 'item_unavailable') return { kind: 'unavailable' };
    if (error.kind === 'not_found') return { kind: 'gone' };
    if (error.kind === 'rate_limited') {
      return { kind: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
    }
    const fields = error.details?.fields as Record<string, { code?: string }[]> | undefined;
    if (fields?.quantity?.some((field) => field.code === 'cart_line_quantity_max')) {
      return { kind: 'too_many' };
    }
    if (
      fields?.special_instructions?.some((field) => field.code === 'special_instructions_too_long')
    ) {
      return { kind: 'instructions_too_long' };
    }
    return { kind: 'error', message: userMessageFor(error), requestId: error.requestId };
  }
  return { kind: 'error', message: userMessageFor(error), requestId: undefined };
}

/** The customer-facing text of a problem. `null` for problems shown elsewhere. */
export function cartProblemMessage(problem: CartProblem): string | null {
  switch (problem.kind) {
    case 'unavailable':
      return "Sorry, that dish isn't available right now. We've updated the menu and your cart.";
    case 'gone':
      return "That item isn't in your cart any more. We've updated your cart.";
    case 'too_many':
      return `You can order up to ${CART_LINE_MAX_QUANTITY} of one dish.`;
    case 'instructions_too_long':
      return `Instructions can be at most ${SPECIAL_INSTRUCTIONS_MAX_LENGTH} characters.`;
    case 'rate_limited':
      return problem.retryAfterSeconds
        ? `Too many changes at once. Please wait ${problem.retryAfterSeconds} seconds and try again.`
        : 'Too many changes at once. Please wait a moment and try again.';
    case 'session_ended':
      return null;
    case 'error':
      return problem.message;
  }
}
