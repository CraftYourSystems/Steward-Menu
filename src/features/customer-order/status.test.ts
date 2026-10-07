import { describe, expect, it } from 'vitest';
import { orderPagePath } from './paths';
import { CustomerOrderSchema, type CustomerOrder, type OrderStatus } from './schemas';
import { newerOrder, STATUS_COPY } from './status';

const REF = '00000000-0000-4000-8000-000000000001';

function wire(status: OrderStatus, extra: Record<string, unknown> = {}) {
  const money = (amount: number) => ({ amount_minor: amount, currency: 'INR' });
  return {
    data: {
      order_ref: REF,
      token_number: '12',
      status,
      placed_at: '2026-10-06T10:00:00Z',
      restaurant: { name: 'Steward Test Kitchen' },
      table: { number: '1' },
      items: [
        {
          name: 'Dal Makhani',
          quantity: 2,
          special_instructions: null,
          unit_price: money(22000),
          line_total: money(44000),
        },
      ],
      amounts: {
        subtotal: money(44000),
        taxes: [{ label: 'Tax', rate_bp: 500, amount: money(2200) }],
        total: money(46200),
      },
      history: [{ state: 'placed', occurred_at: '2026-10-06T10:00:00Z' }],
      ...extra,
    },
  };
}

function order(status: OrderStatus): CustomerOrder {
  return CustomerOrderSchema.parse(wire(status));
}

describe('CustomerOrderSchema', () => {
  it('parses the order into what the page shows', () => {
    expect(order('cooking')).toMatchObject({
      orderRef: REF,
      tokenNumber: '12',
      status: 'cooking',
      restaurantName: 'Steward Test Kitchen',
      tableNumber: '1',
      items: [
        { name: 'Dal Makhani', quantity: 2, specialInstructions: null, lineTotalMinor: 44000 },
      ],
      subtotalMinor: 44000,
      taxes: [{ label: 'Tax', amountMinor: 2200 }],
      totalMinor: 46200,
      history: [{ state: 'placed', occurredAt: '2026-10-06T10:00:00Z' }],
    });
  });

  it('refuses states outside the minimal lifecycle', () => {
    for (const status of ['cancelled', 'served', 'paid']) {
      expect(CustomerOrderSchema.safeParse(wire(status as OrderStatus)).success).toBe(false);
    }
  });
});

describe('newerOrder', () => {
  it('never moves the status backwards for the same order', () => {
    expect(newerOrder(order('ready_to_serve'), order('cooking')).status).toBe('ready_to_serve');
    expect(newerOrder(order('cooking'), order('ready_to_serve')).status).toBe('ready_to_serve');
    expect(newerOrder(undefined, order('placed')).status).toBe('placed');
    const other = { ...order('placed'), orderRef: 'another' };
    expect(newerOrder(order('completed'), other)).toBe(other);
  });
});

describe('copy and paths', () => {
  it('has customer copy for every state and an encoded order path', () => {
    expect(Object.keys(STATUS_COPY)).toEqual(['placed', 'cooking', 'ready_to_serve', 'completed']);
    expect(orderPagePath('qr 1', REF)).toBe(`/t/qr%201/orders/${REF}`);
  });
});
