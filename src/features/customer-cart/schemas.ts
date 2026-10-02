import { z } from 'zod';

/** The most of one dish a cart line holds (F-01 TD-10). The backend enforces it. */
export const CART_LINE_MAX_QUANTITY = 20;
/** The longest special instructions after normalization (F-01 TD-16). The backend enforces it. */
export const SPECIAL_INSTRUCTIONS_MAX_LENGTH = 200;

/*
 * The server-side cart — F-01 technical design §5 (S2). Every cart endpoint
 * answers with the whole cart. Prices are the items' current base prices (no
 * price lock before Review, F1-09); the subtotal and item count cover the
 * available lines only. The frontend displays these values and never
 * recalculates them.
 */
const MoneySchema = z.object({
  amount_minor: z.number().int().nonnegative(),
  currency: z.literal('INR'),
});

const CartLineSchema = z
  .object({
    id: z.string().min(1),
    menu_item_id: z.string().min(1),
    name: z.string().min(1),
    unit_price: MoneySchema,
    quantity: z.number().int().min(1).max(CART_LINE_MAX_QUANTITY),
    line_total: MoneySchema,
    available: z.boolean(),
    special_instructions: z.string().min(1).max(SPECIAL_INSTRUCTIONS_MAX_LENGTH).nullable(),
  })
  .transform((line) => ({
    id: line.id,
    menuItemId: line.menu_item_id,
    name: line.name,
    unitPriceMinor: line.unit_price.amount_minor,
    quantity: line.quantity,
    lineTotalMinor: line.line_total.amount_minor,
    available: line.available,
    specialInstructions: line.special_instructions,
  }));
export type CartLine = z.output<typeof CartLineSchema>;

export const CartSchema = z
  .object({
    data: z.object({
      lines: z.array(CartLineSchema),
      subtotal: MoneySchema,
      item_count: z.number().int().nonnegative(),
    }),
  })
  .transform(({ data }) => ({
    lines: data.lines,
    subtotalMinor: data.subtotal.amount_minor,
    itemCount: data.item_count,
  }));
export type Cart = z.output<typeof CartSchema>;
