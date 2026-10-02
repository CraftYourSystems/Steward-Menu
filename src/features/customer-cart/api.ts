import { customerGet, customerSend } from '@/lib/api/customer';
import type { RequestOptions } from '@/lib/api/request';
import { CartSchema, type Cart } from './schemas';

/*
 * The session's server-side cart (F-01 technical design §5). The cart belongs
 * to the HttpOnly customer-session cookie; the browser sends only an item or
 * line ID and a quantity, never a price, restaurant or total.
 */

export function fetchCart(options: RequestOptions = {}): Promise<Cart> {
  return customerGet('/customer/cart', CartSchema, undefined, options);
}

/** Adds a dish, or adds to its existing line (one line per dish). */
export function addCartLine(menuItemId: string, quantity: number): Promise<Cart> {
  return customerSend('/customer/cart/lines', 'POST', CartSchema, {
    json: { menu_item_id: menuItemId, quantity },
  });
}

export function setCartLineQuantity(lineId: string, quantity: number): Promise<Cart> {
  return customerSend(`/customer/cart/lines/${encodeURIComponent(lineId)}`, 'PATCH', CartSchema, {
    json: { quantity },
  });
}

export function removeCartLine(lineId: string): Promise<Cart> {
  return customerSend(
    `/customer/cart/lines/${encodeURIComponent(lineId)}`,
    'DELETE',
    CartSchema,
    undefined,
  );
}
