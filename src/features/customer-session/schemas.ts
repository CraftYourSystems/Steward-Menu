import { z } from 'zod';

/*
 * POST /customer/sessions — F-01 technical design §1 (S1). The body never
 * carries the session token: it lives only in the HttpOnly cookie.
 */
export const EnteredSessionSchema = z
  .object({
    data: z.object({
      // S1 sessions are always in the cart stage; later slices add stages.
      session: z.object({ stage: z.literal('cart'), order_ref: z.null() }),
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
    restaurantName: data.restaurant.name,
    tableNumber: data.table.number,
  }));
export type EnteredSession = z.output<typeof EnteredSessionSchema>;
