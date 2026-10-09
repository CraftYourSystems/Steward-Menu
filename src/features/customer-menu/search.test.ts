import { describe, expect, it } from 'vitest';
import { buildCustomerMenu } from '@/test/factories/customer';
import { CustomerMenuSchema, type CustomerMenu } from './schemas';
import { filterMenuByName, normalizeSearchText } from './search';

const menu = CustomerMenuSchema.parse(buildCustomerMenu());

function names(result: CustomerMenu) {
  return [
    ...result.categories.flatMap((category) => category.items.map((item) => item.name)),
    ...result.uncategorized.map((item) => item.name),
  ];
}

describe('filterMenuByName (F1-27, technical design §4)', () => {
  it('returns the menu unchanged for an empty or blank query', () => {
    expect(filterMenuByName(menu, '')).toBe(menu);
    expect(filterMenuByName(menu, '   ')).toBe(menu);
  });

  it('matches a case-insensitive substring of the name', () => {
    expect(names(filterMenuByName(menu, 'dal'))).toEqual(['Dal Makhani']);
    expect(names(filterMenuByName(menu, 'MAKH'))).toEqual(['Dal Makhani']);
    expect(names(filterMenuByName(menu, 'a'))).toEqual([
      'Dal Makhani',
      'Paneer Tikka',
      'Masala Chaas',
    ]);
  });

  it('collapses and trims whitespace in the query and the name', () => {
    expect(names(filterMenuByName(menu, '  dal    makhani '))).toEqual(['Dal Makhani']);
    expect(names(filterMenuByName(menu, 'dal\tmakhani'))).toEqual(['Dal Makhani']);
  });

  it('normalizes Unicode (NFKC), so compatibility forms match', () => {
    // Fullwidth letters and a non-breaking space normalize to plain text.
    expect(names(filterMenuByName(menu, 'ＤＡＬ'))).toEqual(['Dal Makhani']);
    expect(names(filterMenuByName(menu, 'dal makhani'))).toEqual(['Dal Makhani']);
    expect(normalizeSearchText('Ｍａｓａｌａ  Chaas')).toBe('masala chaas');
  });

  it('searches names only: never categories, prices or preparation times', () => {
    expect(names(filterMenuByName(menu, 'Mains'))).toEqual([]);
    expect(names(filterMenuByName(menu, 'Starters'))).toEqual([]);
    expect(names(filterMenuByName(menu, 'Other dishes'))).toEqual([]);
    expect(names(filterMenuByName(menu, '220'))).toEqual([]);
    expect(names(filterMenuByName(menu, '20 min'))).toEqual([]);
  });

  it('drops categories with no match and keeps the uncategorized group separate', () => {
    const result = filterMenuByName(menu, 'chaas');
    expect(result.categories).toEqual([]);
    expect(result.uncategorized.map((item) => item.name)).toEqual(['Masala Chaas']);
  });
});
