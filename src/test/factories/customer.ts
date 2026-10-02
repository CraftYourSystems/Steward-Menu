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
