import { customerGet, customerSend } from '@/lib/api/customer';
import type { RequestOptions } from '@/lib/api/request';
import { CustomerOrderSchema, OrderAccessSchema, type CustomerOrder } from './schemas';

/**
 * The order (S6). Readable by the customer session that placed it (until
 * Completed) or by this browser's order-access grant; anything else, including
 * an unknown or expired reference, answers the same generic 404.
 */
export function fetchCustomerOrder(
  orderRef: string,
  options: RequestOptions = {},
): Promise<CustomerOrder> {
  return customerGet(
    `/customer/orders/${encodeURIComponent(orderRef)}`,
    CustomerOrderSchema,
    undefined,
    options,
  );
}

/**
 * Redeems an SMS link's secret for this order (S6, F1-18): the backend sets the
 * HttpOnly `steward_order_access` grant cookie. The secret is sent once, in the
 * body, and kept nowhere.
 */
export function redeemOrderAccess(orderRef: string, secret: string) {
  return customerSend('/customer/order-access', 'POST', OrderAccessSchema, {
    json: { order_ref: orderRef, secret },
  });
}

export type { CustomerOrder };
