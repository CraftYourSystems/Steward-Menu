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

export function buildEnteredSession(tableNumber = '1', restaurantName = MOCK_RESTAURANT_NAME) {
  return {
    data: {
      session: { stage: 'cart', order_ref: null },
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
};

export function buildCartLine(
  dish: Dish,
  quantity: number,
  { id = `line-${dish.id}`, available = true }: { id?: string; available?: boolean } = {},
): WireCartLine {
  return {
    id,
    menu_item_id: dish.id,
    name: dish.name,
    unit_price: { amount_minor: dish.priceMinor, currency: 'INR' },
    quantity,
    line_total: { amount_minor: dish.priceMinor * quantity, currency: 'INR' },
    available,
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
