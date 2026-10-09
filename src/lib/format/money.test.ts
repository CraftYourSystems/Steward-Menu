import { describe, expect, it } from 'vitest';
import { formatInr } from './money';

describe('formatInr', () => {
  it('formats paise with Indian digit grouping', () => {
    expect(formatInr(12_345_678)).toBe('₹1,23,456.78');
  });

  it('formats zero and small amounts', () => {
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(5)).toBe('₹0.05');
  });

  it('formats large amounts', () => {
    expect(formatInr(1_000_000_000)).toBe('₹1,00,00,000.00');
  });
});
