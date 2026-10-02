import { z } from 'zod';

/*
 * The open checkout — F-01 technical design §9 (S3): the reviewed snapshot of
 * the cart and details, priced by the backend. It is the price lock (§11).
 * Every amount here is displayed exactly as returned; the browser never
 * calculates tax or totals.
 */
const MoneySchema = z.object({
  amount_minor: z.number().int().nonnegative(),
  currency: z.literal('INR'),
});

const CheckoutLineSchema = z
  .object({
    name: z.string().min(1),
    unit_price: MoneySchema,
    quantity: z.number().int().min(1).max(20),
    special_instructions: z.string().min(1).max(200).nullable(),
    line_total: MoneySchema,
  })
  .transform((line) => ({
    name: line.name,
    unitPriceMinor: line.unit_price.amount_minor,
    quantity: line.quantity,
    specialInstructions: line.special_instructions,
    lineTotalMinor: line.line_total.amount_minor,
  }));
export type CheckoutLine = z.output<typeof CheckoutLineSchema>;

export const CheckoutSchema = z
  .object({
    data: z.object({
      checkout_id: z.string().min(1),
      status: z.literal('open'),
      customer: z.object({ name: z.string().min(1), mobile_display: z.string().min(1) }),
      table: z.object({ number: z.string().min(1) }),
      lines: z.array(CheckoutLineSchema).min(1),
      amounts: z.object({
        subtotal: MoneySchema,
        // One restaurant-wide tax, labelled "Tax" (F1-06); the list shape is kept.
        taxes: z.array(
          z.object({ label: z.string().min(1), rate_bp: z.number().int(), amount: MoneySchema }),
        ),
        total: MoneySchema,
      }),
    }),
  })
  .transform(({ data }) => ({
    checkoutId: data.checkout_id,
    customerName: data.customer.name,
    mobileDisplay: data.customer.mobile_display,
    tableNumber: data.table.number,
    lines: data.lines,
    subtotalMinor: data.amounts.subtotal.amount_minor,
    taxes: data.amounts.taxes.map((tax) => ({
      label: tax.label,
      amountMinor: tax.amount.amount_minor,
    })),
    totalMinor: data.amounts.total.amount_minor,
  }));
export type Checkout = z.output<typeof CheckoutSchema>;
