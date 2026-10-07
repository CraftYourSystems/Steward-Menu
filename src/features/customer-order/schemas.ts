import { z } from 'zod';

/*
 * GET /customer/orders/{order_ref} (F-01 S6; technical design §23, §24): the
 * placed order's snapshot and its lifecycle. It never carries the customer's
 * name or mobile, staff identities, secrets or payment references.
 */

export const ORDER_STATUSES = ['placed', 'cooking', 'ready_to_serve', 'completed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const MoneySchema = z.object({ amount_minor: z.number().int(), currency: z.literal('INR') });

export const CustomerOrderSchema = z
  .object({
    data: z.object({
      order_ref: z.string().min(1),
      token_number: z.string().min(1),
      status: z.enum(ORDER_STATUSES),
      placed_at: z.iso.datetime(),
      restaurant: z.object({ name: z.string().min(1) }),
      table: z.object({ number: z.string().min(1) }),
      items: z
        .array(
          z.object({
            name: z.string().min(1),
            quantity: z.number().int().positive(),
            special_instructions: z.string().nullable(),
            unit_price: MoneySchema,
            line_total: MoneySchema,
          }),
        )
        .min(1),
      amounts: z.object({
        subtotal: MoneySchema,
        taxes: z.array(
          z.object({ label: z.string().min(1), rate_bp: z.number().int(), amount: MoneySchema }),
        ),
        total: MoneySchema,
      }),
      history: z.array(z.object({ state: z.enum(ORDER_STATUSES), occurred_at: z.iso.datetime() })),
    }),
  })
  .transform(({ data }) => ({
    orderRef: data.order_ref,
    tokenNumber: data.token_number,
    status: data.status,
    placedAt: data.placed_at,
    restaurantName: data.restaurant.name,
    tableNumber: data.table.number,
    items: data.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      specialInstructions: item.special_instructions,
      lineTotalMinor: item.line_total.amount_minor,
    })),
    subtotalMinor: data.amounts.subtotal.amount_minor,
    taxes: data.amounts.taxes.map((tax) => ({
      label: tax.label,
      amountMinor: tax.amount.amount_minor,
    })),
    totalMinor: data.amounts.total.amount_minor,
    history: data.history.map((entry) => ({ state: entry.state, occurredAt: entry.occurred_at })),
  }));
export type CustomerOrder = z.output<typeof CustomerOrderSchema>;

/** POST /customer/order-access: the grant cookie is set; the body names the order only. */
export const OrderAccessSchema = z
  .object({ data: z.object({ order_ref: z.string().min(1) }) })
  .transform(({ data }) => ({ orderRef: data.order_ref }));

/**
 * A realtime event (§25): identifiers and a status hint only. Events never
 * change what the page shows by themselves: each one triggers a refetch (§26).
 */
export const RealtimeEventSchema = z.object({
  event_id: z.string().min(1),
  type: z.string().min(1),
  order_id: z.string().optional(),
  order_status: z.enum(ORDER_STATUSES).optional(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
