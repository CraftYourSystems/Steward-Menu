/*
 * Customer (F-01 S1) fixtures in the backend's wire shapes. QR codes are
 * 22-character opaque strings, like the backend's.
 */

export const MOCK_RESTAURANT_NAME = 'Steward Test Kitchen';

export const MOCK_QR = {
  table1: 'mockQrTable01Active000',
  table2: 'mockQrTable02Active000',
  inactive: 'mockQrTable03Inactive0',
  /** Well-formed but unknown. */
  unknown: 'mockQrUnknownTable0000',
} as const;

export const MOCK_TABLES: Record<string, { number: string; active: boolean }> = {
  [MOCK_QR.table1]: { number: '1', active: true },
  [MOCK_QR.table2]: { number: '2', active: true },
  [MOCK_QR.inactive]: { number: '3', active: false },
};

export function buildEnteredSession(
  tableNumber = '1',
  restaurantName = MOCK_RESTAURANT_NAME,
  stage: 'cart' | 'payment' | 'placed' | 'payment_issue' = 'cart',
  orderRef: string | null = null,
) {
  return {
    data: {
      session: { stage, order_ref: orderRef },
      restaurant: { name: restaurantName, branding: null },
      table: { number: tableNumber },
    },
  };
}

type WireItem = {
  id: string;
  name: string;
  base_price: { amount_minor: number; currency: 'INR' };
  preparation_time_minutes: number | null;
  image_ref: string | null;
};

function item(id: string, name: string, amountMinor: number, prep: number | null): WireItem {
  return {
    id,
    name,
    base_price: { amount_minor: amountMinor, currency: 'INR' },
    preparation_time_minutes: prep,
    image_ref: null,
  };
}

/** The seeded S1 menu: available items in two categories plus one uncategorized item. */
export function buildCustomerMenu() {
  return {
    data: {
      categories: [
        { id: 'cat-mains', name: 'Mains', items: [item('item-dal', 'Dal Makhani', 22000, 20)] },
        {
          id: 'cat-starters',
          name: 'Starters',
          items: [item('item-paneer', 'Paneer Tikka', 24900, 15)],
        },
      ],
      uncategorized: [item('item-chaas', 'Masala Chaas', 6000, null)],
    },
  };
}

export function buildEmptyCustomerMenu() {
  return { data: { categories: [], uncategorized: [] } };
}

/** The dishes of `buildCustomerMenu`, as the mock backend's catalog. */
export const MOCK_DISHES = {
  dal: { id: 'item-dal', name: 'Dal Makhani', priceMinor: 22000 },
  paneer: { id: 'item-paneer', name: 'Paneer Tikka', priceMinor: 24900 },
  chaas: { id: 'item-chaas', name: 'Masala Chaas', priceMinor: 6000 },
} as const;

type Dish = { id: string; name: string; priceMinor: number };

export type WireCartLine = {
  id: string;
  menu_item_id: string;
  name: string;
  unit_price: { amount_minor: number; currency: 'INR' };
  quantity: number;
  line_total: { amount_minor: number; currency: 'INR' };
  available: boolean;
  special_instructions: string | null;
};

export function buildCartLine(
  dish: Dish,
  quantity: number,
  {
    id = `line-${dish.id}`,
    available = true,
    specialInstructions = null,
  }: { id?: string; available?: boolean; specialInstructions?: string | null } = {},
): WireCartLine {
  return {
    id,
    menu_item_id: dish.id,
    name: dish.name,
    unit_price: { amount_minor: dish.priceMinor, currency: 'INR' },
    quantity,
    line_total: { amount_minor: dish.priceMinor * quantity, currency: 'INR' },
    available,
    special_instructions: specialInstructions,
  };
}

/**
 * A cart in the backend's wire shape. Like the backend, the subtotal and item
 * count cover the available lines only.
 */
export function buildCart(lines: WireCartLine[] = []) {
  const orderable = lines.filter((line) => line.available);
  return {
    data: {
      lines,
      subtotal: {
        amount_minor: orderable.reduce((sum, line) => sum + line.line_total.amount_minor, 0),
        currency: 'INR' as const,
      },
      item_count: orderable.reduce((sum, line) => sum + line.quantity, 0),
    },
  };
}

/** The fixture tax rate of the mock restaurant: 500 basis points (5 %), like the backend seed. */
export const MOCK_TAX_RATE_BP = 500;

export const MOCK_CUSTOMER = { name: 'Asha Rao', mobile: '+919876543210' } as const;

/** Half-up tax on the subtotal, as the backend calculates it (technical design §10). */
export function mockTaxMinor(subtotalMinor: number, rateBp: number): number {
  return Math.floor((subtotalMinor * rateBp + 5000) / 10000);
}

export type WireAttemptStatus = 'awaiting_payment' | 'paid' | 'failed' | 'abandoned';

/** The payment summary of a `payment_started` checkout (S4, technical design §14). */
export function buildPaymentSummary(statuses: WireAttemptStatus[], attemptsLimit = 5) {
  const latest = statuses.at(-1);
  return {
    latest_attempt: latest ? { status: latest } : null,
    attempts_made: statuses.length,
    attempts_limit: attemptsLimit,
  };
}

/**
 * A checkout in the backend's wire shape (technical design §9), priced like the
 * backend: `open`, or `payment_started` with the attempts' statuses (S4).
 */
export function buildCheckout({
  checkoutId = 'checkout-1',
  name = MOCK_CUSTOMER.name,
  mobile = MOCK_CUSTOMER.mobile,
  tableNumber = '1',
  lines,
  rateBp = MOCK_TAX_RATE_BP,
  attempts,
  outcome,
}: {
  checkoutId?: string;
  name?: string;
  mobile?: string;
  tableNumber?: string;
  lines: { dish: Dish; quantity: number; specialInstructions?: string | null }[];
  rateBp?: number;
  /** Given: the checkout is `payment_started` with these attempts, oldest first. */
  attempts?: WireAttemptStatus[];
  /** S5: the verified payment's outcome, with the placed order's token and time. */
  outcome?:
    | { status: 'placed'; orderRef: string; tokenNumber: string; placedAt: string }
    | { status: 'paid_not_placed' };
}) {
  const wireLines = lines.map((line) => ({
    name: line.dish.name,
    unit_price: { amount_minor: line.dish.priceMinor, currency: 'INR' as const },
    quantity: line.quantity,
    special_instructions: line.specialInstructions ?? null,
    line_total: { amount_minor: line.dish.priceMinor * line.quantity, currency: 'INR' as const },
  }));
  const subtotal = wireLines.reduce((sum, line) => sum + line.line_total.amount_minor, 0);
  const tax = mockTaxMinor(subtotal, rateBp);
  const national = mobile.slice(3);
  return {
    data: {
      checkout_id: checkoutId,
      status: (outcome?.status ?? (attempts ? 'payment_started' : 'open')) as
        'open' | 'payment_started' | 'placed' | 'paid_not_placed',
      customer: { name, mobile_display: `+91 ${national.slice(0, 5)} ${national.slice(5)}` },
      table: { number: tableNumber },
      lines: wireLines,
      amounts: {
        subtotal: { amount_minor: subtotal, currency: 'INR' as const },
        taxes: [
          {
            label: 'Tax',
            rate_bp: rateBp,
            amount: { amount_minor: tax, currency: 'INR' as const },
          },
        ],
        total: { amount_minor: subtotal + tax, currency: 'INR' as const },
      },
      ...(attempts ? { payment: buildPaymentSummary(attempts) } : {}),
      ...(outcome?.status === 'placed'
        ? {
            order: {
              order_ref: outcome.orderRef,
              token_number: outcome.tokenNumber,
              placed_at: outcome.placedAt,
            },
          }
        : {}),
    },
  };
}
