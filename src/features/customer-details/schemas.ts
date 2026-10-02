import { z } from 'zod';

/** The longest customer name after trimming (F-01 TD-14). The backend enforces it. */
export const CUSTOMER_NAME_MAX_LENGTH = 80;

/*
 * GET/PUT /customer/details — F-01 technical design §7 (S3). The customer's own
 * details, in full: Name and an Indian mobile number in E.164. `null`s until
 * given. The backend validates and normalizes; the browser never does.
 */
export const DetailsSchema = z
  .object({
    data: z.object({
      name: z.string().min(1).max(CUSTOMER_NAME_MAX_LENGTH).nullable(),
      mobile: z
        .string()
        .regex(/^\+91[6-9][0-9]{9}$/)
        .nullable(),
    }),
  })
  .transform(({ data }) => data);
export type CustomerDetails = z.output<typeof DetailsSchema>;

/** An E.164 Indian mobile as the customer typed it: the 10-digit national number. */
export function nationalNumber(e164: string | null): string {
  return e164 ? e164.slice(3) : '';
}
