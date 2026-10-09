import { customerGet, customerSend } from '@/lib/api/customer';
import { ApiError } from '@/lib/api/errors';
import type { RequestOptions } from '@/lib/api/request';
import {
  CheckoutPaymentStateSchema,
  CheckoutSchema,
  PaymentRedirectSchema,
  type Checkout,
  type CheckoutPaymentState,
} from './schemas';

/**
 * The session's active checkout (`open`, or `payment_started` since S4), or
 * `null` when there is none (404). Reading never creates a checkout.
 */
export async function fetchCheckout(options: RequestOptions = {}): Promise<Checkout | null> {
  try {
    return await customerGet('/customer/checkout', CheckoutSchema, undefined, options);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'not_found') return null;
    throw error;
  }
}

/**
 * Review (S3): the backend revalidates the cart, prices it with the restaurant's
 * tax rate and returns the new open checkout. Only ever sent on an explicit
 * customer action; the request carries no amounts.
 */
export function reviewOrder(): Promise<Checkout> {
  return customerSend('/customer/checkout/review', 'POST', CheckoutSchema, undefined);
}

function checkoutPath(checkoutId: string, action: string): string {
  return `/customer/checkout/${encodeURIComponent(checkoutId)}/${action}`;
}

/**
 * Pay (S4): starts payment on the reviewed checkout, or retries it after a
 * failed or abandoned attempt, and returns where the browser goes to pay. The
 * request carries no amount: the backend charges the locked reviewed total.
 */
export function initiatePayment(checkoutId: string): Promise<{ redirectUrl: string }> {
  return customerSend(
    checkoutPath(checkoutId, 'payments'),
    'POST',
    PaymentRedirectSchema,
    undefined,
  );
}

/** Review / change order (S4): releases the checkout; the cart unlocks with its lines. */
export function releaseCheckout(checkoutId: string): Promise<CheckoutPaymentState> {
  return customerSend(
    checkoutPath(checkoutId, 'release'),
    'POST',
    CheckoutPaymentStateSchema,
    undefined,
  );
}

/**
 * The payment return page's poll (S4). The backend may ask the gateway, server
 * to server; the browser never decides a payment's outcome.
 */
export function fetchCheckoutStatus(
  checkoutId: string,
  options: RequestOptions = {},
): Promise<CheckoutPaymentState> {
  return customerGet(
    checkoutPath(checkoutId, 'status'),
    CheckoutPaymentStateSchema,
    undefined,
    options,
  );
}
