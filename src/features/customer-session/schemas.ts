import { z } from 'zod';

/*
 * POST /customer/sessions — F-01 technical design §1 (S1). The body never
 * carries the session token: it lives only in the HttpOnly cookie.
 */
export const EnteredSessionSchema = z
  .object({
    data: z.object({
      // `payment` (S4): payment was initiated; `placed` / `payment_issue` (S5): the
      // order was placed, or the payment could not be placed (F1-22). In each case
      // the customer resumes at the payment return page, not the cart (§1, §14).
      session: z.object({
        stage: z.enum(['cart', 'payment', 'placed', 'payment_issue']),
        order_ref: z.string().min(1).nullable(),
      }),
      restaurant: z.object({
        name: z.string().min(1),
        // F8-BCD-5 is not provided by the backend yet: safe defaults apply.
        branding: z.null(),
      }),
      table: z.object({ number: z.string().min(1) }),
    }),
  })
  .transform(({ data }) => ({
    stage: data.session.stage,
    // A placed session's order (S6): its order page is `/t/{qr}/orders/{orderRef}`.
    orderRef: data.session.order_ref,
    restaurantName: data.restaurant.name,
    tableNumber: data.table.number,
  }));
export type EnteredSession = z.output<typeof EnteredSessionSchema>;
