import { z } from 'zod';

/*
 * GET /customer/menu — F-01 technical design §3 (S1). The backend returns only
 * available, not deleted items of the customer session's restaurant; the
 * frontend never filters for availability itself (F-02 §4).
 */
const MenuItemSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    base_price: z.object({
      amount_minor: z.number().int().nonnegative(),
      currency: z.literal('INR'),
    }),
    preparation_time_minutes: z.number().int().positive().nullable(),
    image_ref: z.string().nullable(),
  })
  .transform((item) => ({
    id: item.id,
    name: item.name,
    basePriceMinor: item.base_price.amount_minor,
    preparationTimeMinutes: item.preparation_time_minutes,
    imageRef: item.image_ref,
  }));
export type CustomerMenuItem = z.output<typeof MenuItemSchema>;

export const CustomerMenuSchema = z
  .object({
    data: z.object({
      categories: z.array(
        z.object({ id: z.string(), name: z.string().min(1), items: z.array(MenuItemSchema) }),
      ),
      uncategorized: z.array(MenuItemSchema),
    }),
  })
  .transform(({ data }) => data);
export type CustomerMenu = z.output<typeof CustomerMenuSchema>;
