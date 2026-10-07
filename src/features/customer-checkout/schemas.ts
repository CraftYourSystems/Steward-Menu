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

/*
 * The payment state of a `payment_started` checkout (S4, technical design §14):
 * the latest attempt's status and how many of the allowed attempts were made.
 * Never a gateway reference or redirect URL. S4 never reports `paid`; it is in
 * the schema because the backend model has it (S5).
 */
export const AttemptStatusSchema = z.enum(['awaiting_payment', 'paid', 'failed', 'abandoned']);
export type AttemptStatus = z.output<typeof AttemptStatusSchema>;

export const PaymentSummarySchema = z
  .object({
    latest_attempt: z.object({ status: AttemptStatusSchema }).nullable(),
    attempts_made: z.number().int().nonnegative(),
    attempts_limit: z.number().int().positive(),
  })
  .transform((payment) => ({
    latestStatus: payment.latest_attempt?.status ?? null,
    attemptsMade: payment.attempts_made,
    attemptsLimit: payment.attempts_limit,
  }));
export type PaymentSummary = z.output<typeof PaymentSummarySchema>;

export const CheckoutSchema = z
  .object({
    data: z.object({
      checkout_id: z.string().min(1),
      // `payment_started` (S4): payment was initiated; the checkout is immutable.
      // `placed` / `paid_not_placed` (S5): the verified payment's outcome.
      status: z.enum(['open', 'payment_started', 'placed', 'paid_not_placed']),
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
      // Present once payment started.
      payment: PaymentSummarySchema.optional(),
      // S5 (P1): present only for a `placed` checkout. The token is a display
      // reference, never a credential (F1-15); `order_ref` (S6) names the order page.
      order: z
        .object({
          order_ref: z.string().min(1),
          token_number: z.string().min(1),
          placed_at: z.iso.datetime(),
        })
        .optional(),
    }),
  })
  .transform(({ data }) => ({
    checkoutId: data.checkout_id,
    status: data.status,
    payment: data.payment ?? null,
    order: data.order
      ? {
          orderRef: data.order.order_ref,
          tokenNumber: data.order.token_number,
          placedAt: data.order.placed_at,
        }
      : null,
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

/*
 * POST /customer/checkout/{id}/payments (S4): where the browser goes to pay.
 * Only an http(s) URL is ever followed.
 */
export const PaymentRedirectSchema = z
  .object({ data: z.object({ redirect_url: z.url({ protocol: /^https?$/ }) }) })
  .transform(({ data }) => ({ redirectUrl: data.redirect_url }));

/*
 * POST /customer/checkout/{id}/release and GET /customer/checkout/{id}/status
 * (S4): the checkout's status and payment summary.
 */
export const CheckoutPaymentStateSchema = z
  .object({
    data: z.object({
      checkout_id: z.string().min(1),
      status: z.enum([
        'open',
        'superseded',
        'payment_started',
        'released',
        'placed',
        'paid_not_placed',
      ]),
      payment: PaymentSummarySchema.nullable(),
    }),
  })
  .transform(({ data }) => ({
    checkoutId: data.checkout_id,
    status: data.status,
    payment: data.payment,
  }));
export type CheckoutPaymentState = z.output<typeof CheckoutPaymentStateSchema>;
