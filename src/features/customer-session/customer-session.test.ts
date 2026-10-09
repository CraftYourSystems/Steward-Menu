import { describe, expect, it } from 'vitest';
import { CustomerMenuSchema } from '@/features/customer-menu/schemas';
import { ApiError } from '@/lib/api/errors';
import { buildCustomerMenu, buildEnteredSession } from '@/test/factories/customer';
import { entryProblemFor } from './entry-problem';
import { EnteredSessionSchema } from './schemas';

describe('EnteredSessionSchema', () => {
  it('parses the entry response without any token', () => {
    expect(EnteredSessionSchema.parse(buildEnteredSession('7', 'Taqila Bar'))).toEqual({
      stage: 'cart',
      orderRef: null,
      restaurantName: 'Taqila Bar',
      tableNumber: '7',
    });
  });

  it('rejects responses outside the S1 contract', () => {
    const base = buildEnteredSession();
    expect(EnteredSessionSchema.safeParse({ data: { ...base.data, table: {} } }).success).toBe(
      false,
    );
    expect(
      EnteredSessionSchema.safeParse({
        data: { ...base.data, session: { stage: 'ended', order_ref: null } },
      }).success,
    ).toBe(false);
    // S5: a placed session resumes with its order reference.
    expect(
      EnteredSessionSchema.parse({
        data: { ...base.data, session: { stage: 'placed', order_ref: 'o1' } },
      }).stage,
    ).toBe('placed');
  });
});

describe('CustomerMenuSchema', () => {
  it('parses categories and uncategorized items into camelCase', () => {
    const menu = CustomerMenuSchema.parse(buildCustomerMenu());
    expect(menu.categories.map((category) => category.name)).toEqual(['Mains', 'Starters']);
    expect(menu.categories[0]?.items[0]).toEqual({
      id: 'item-dal',
      name: 'Dal Makhani',
      basePriceMinor: 22000,
      preparationTimeMinutes: 20,
      imageRef: null,
    });
    expect(menu.uncategorized.map((item) => item.name)).toEqual(['Masala Chaas']);
  });

  it('rejects negative or fractional prices and other currencies', () => {
    const wire = buildCustomerMenu();
    const withPrice = (base_price: unknown) => ({
      data: {
        ...wire.data,
        uncategorized: [{ ...wire.data.uncategorized[0], base_price }],
      },
    });
    expect(
      CustomerMenuSchema.safeParse(withPrice({ amount_minor: -1, currency: 'INR' })).success,
    ).toBe(false);
    expect(
      CustomerMenuSchema.safeParse(withPrice({ amount_minor: 1.5, currency: 'INR' })).success,
    ).toBe(false);
    expect(
      CustomerMenuSchema.safeParse(withPrice({ amount_minor: 100, currency: 'USD' })).success,
    ).toBe(false);
  });
});

describe('entryProblemFor', () => {
  const error = (status: number, kind: ApiError['kind'], code?: string, details?: object) =>
    new ApiError({ status, kind, code, details: details as Record<string, unknown> | undefined });

  it('maps every documented entry failure by code', () => {
    expect(entryProblemFor(error(404, 'not_found', 'not_found'))).toEqual({ kind: 'invalid' });
    expect(entryProblemFor(error(409, 'conflict', 'table_unavailable'))).toEqual({
      kind: 'unavailable',
    });
    expect(
      entryProblemFor(
        error(409, 'conflict', 'customer_session_other_table', { table_number: '4' }),
      ),
    ).toEqual({ kind: 'other_table', tableNumber: '4' });
    expect(
      entryProblemFor(new ApiError({ status: 429, kind: 'rate_limited', retryAfterSeconds: 12 })),
    ).toEqual({ kind: 'rate_limited', retryAfterSeconds: 12 });
  });

  it('treats anything else, including a malformed conflict, as a generic error', () => {
    const conflict = error(409, 'conflict', 'customer_session_other_table', {});
    expect(entryProblemFor(conflict)).toEqual({ kind: 'error', error: conflict });
    const server = error(500, 'server', 'internal_error');
    expect(entryProblemFor(server)).toEqual({ kind: 'error', error: server });
    const plain = new Error('boom');
    expect(entryProblemFor(plain)).toEqual({ kind: 'error', error: plain });
  });
});
