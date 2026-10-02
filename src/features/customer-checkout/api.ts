import { customerGet, customerSend } from '@/lib/api/customer';
import { ApiError } from '@/lib/api/errors';
import type { RequestOptions } from '@/lib/api/request';
import { CheckoutSchema, type Checkout } from './schemas';

/**
 * The session's open checkout, or `null` when there is none (404). Reading
 * never creates a checkout.
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
