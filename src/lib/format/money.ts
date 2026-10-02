const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats an INR amount given in paise (F-07 design BCD-3), using Indian
 * digit grouping. Display only — never used to calculate totals.
 */
export function formatInr(amountMinor: number): string {
  return inrFormatter.format(amountMinor / 100);
}
