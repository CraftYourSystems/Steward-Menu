import type { CustomerMenu } from './schemas';

/**
 * Normalizes text for name search (F-01 technical design §4): Unicode NFKC,
 * whitespace collapsed and trimmed, case folded.
 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-IN');
}

/**
 * The menu filtered by item **name** only (F1-27): a case-insensitive substring
 * match after normalization. Nothing else (category, price, time) is searched.
 * Runs on the menu the backend already returned, so unavailable items can never
 * appear (TD-9). An empty query returns the menu unchanged; categories left with
 * no match are dropped.
 */
export function filterMenuByName(menu: CustomerMenu, query: string): CustomerMenu {
  const needle = normalizeSearchText(query);
  if (!needle) return menu;
  const matches = (name: string) => normalizeSearchText(name).includes(needle);
  return {
    categories: menu.categories
      .map((category) => ({ ...category, items: category.items.filter((i) => matches(i.name)) }))
      .filter((category) => category.items.length > 0),
    uncategorized: menu.uncategorized.filter((item) => matches(item.name)),
  };
}
