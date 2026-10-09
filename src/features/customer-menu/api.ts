import { customerGet } from '@/lib/api/customer';
import type { RequestOptions } from '@/lib/api/request';
import { CustomerMenuSchema, type CustomerMenu } from './schemas';

/** The menu of the customer session's restaurant (scoped server-side, never by the client). */
export function fetchCustomerMenu(options: RequestOptions = {}): Promise<CustomerMenu> {
  return customerGet('/customer/menu', CustomerMenuSchema, undefined, options);
}
