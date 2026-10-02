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

/** Adds a dish, or adds to the dish's line with the same instructions (none here). */
export function addCartLine(menuItemId: string, quantity: number): Promise<Cart> {
  return customerSend('/customer/cart/lines', 'POST', CartSchema, {
    json: { menu_item_id: menuItemId, quantity },
  });
}

/**
 * Changes a line's quantity and/or special instructions (S3). `null` or blank
 * instructions clear them; instructions matching another line of the same dish
 * merge the two lines on the server.
 */
export function updateCartLine(
  lineId: string,
  change: { quantity?: number; specialInstructions?: string | null },
): Promise<Cart> {
  const json: Record<string, unknown> = {};
  if (change.quantity !== undefined) json.quantity = change.quantity;
  if (change.specialInstructions !== undefined) {
    json.special_instructions = change.specialInstructions;
  }
  return customerSend(`/customer/cart/lines/${encodeURIComponent(lineId)}`, 'PATCH', CartSchema, {
    json,
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
