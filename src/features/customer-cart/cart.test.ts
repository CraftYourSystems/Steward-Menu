import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { buildCart, buildCartLine, MOCK_DISHES } from '@/test/factories/customer';
import { cartProblemFor, cartProblemMessage } from './cart-problem';
import { CartSchema } from './schemas';

describe('CartSchema', () => {
  it('parses the server cart into camelCase, keeping the server totals', () => {
    const wire = buildCart([
      buildCartLine(MOCK_DISHES.dal, 2),
      buildCartLine(MOCK_DISHES.paneer, 1, { available: false }),
    ]);
    expect(CartSchema.parse(wire)).toEqual({
      lines: [
        {
          id: 'line-item-dal',
          menuItemId: 'item-dal',
          name: 'Dal Makhani',
          unitPriceMinor: 22000,
          quantity: 2,
          lineTotalMinor: 44000,
          available: true,
          specialInstructions: null,
        },
        {
          id: 'line-item-paneer',
          menuItemId: 'item-paneer',
          name: 'Paneer Tikka',
          unitPriceMinor: 24900,
          quantity: 1,
          lineTotalMinor: 24900,
          available: false,
          specialInstructions: null,
        },
      ],
      // Unavailable lines are left out by the server, not by the browser.
      subtotalMinor: 44000,
      itemCount: 2,
    });
  });

  it('rejects carts outside the S2 contract', () => {
    const line = buildCartLine(MOCK_DISHES.dal, 1);
    const cart = (lines: unknown[], extra: object = {}) => ({
      data: { ...buildCart().data, lines, ...extra },
    });
    for (const bad of [
      cart([{ ...line, quantity: 0 }]),
      cart([{ ...line, quantity: 21 }]),
      cart([{ ...line, quantity: 1.5 }]),
      cart([{ ...line, unit_price: { amount_minor: 100, currency: 'USD' } }]),
      cart([{ ...line, line_total: { amount_minor: -1, currency: 'INR' } }]),
      cart([{ ...line, available: 'yes' }]),
      cart([], { item_count: -1 }),
      { data: { lines: [] } },
    ]) {
      expect(CartSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('cartProblemFor', () => {
  const error = (status: number, kind: ApiError['kind'], code?: string, details?: object) =>
    new ApiError({ status, kind, code, details: details as Record<string, unknown> | undefined });

  it('maps every documented cart failure by code', () => {
    expect(cartProblemFor(error(401, 'unauthorized', 'customer_session_expired'))).toEqual({
      kind: 'session_ended',
    });
    expect(cartProblemFor(error(422, 'validation', 'item_unavailable'))).toEqual({
      kind: 'unavailable',
    });
    expect(cartProblemFor(error(404, 'not_found', 'not_found'))).toEqual({ kind: 'gone' });
    expect(
      cartProblemFor(new ApiError({ status: 429, kind: 'rate_limited', retryAfterSeconds: 30 })),
    ).toEqual({ kind: 'rate_limited', retryAfterSeconds: 30 });
    expect(
      cartProblemFor(
        error(422, 'validation', 'validation_failed', {
          fields: { quantity: [{ code: 'cart_line_quantity_max', message: 'm' }] },
        }),
      ),
    ).toEqual({ kind: 'too_many' });
  });

  it('treats anything else as a generic error with its reference', () => {
    const server = new ApiError({ status: 500, kind: 'server', code: 'x', requestId: 'req-1' });
    expect(cartProblemFor(server)).toEqual({
      kind: 'error',
      message: 'Something went wrong on our side. Try again.',
      requestId: 'req-1',
    });
    expect(cartProblemFor(new Error('boom'))).toMatchObject({ kind: 'error' });
  });

  it('words each problem for the customer, and leaves the session to the boundary', () => {
    expect(cartProblemMessage({ kind: 'unavailable' })).toMatch(/isn't available right now/);
    expect(cartProblemMessage({ kind: 'too_many' })).toBe('You can order up to 20 of one dish.');
    expect(cartProblemMessage({ kind: 'rate_limited', retryAfterSeconds: 12 })).toMatch(
      /wait 12 seconds/,
    );
    expect(cartProblemMessage({ kind: 'session_ended' })).toBeNull();
  });
});
