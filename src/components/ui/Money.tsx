import { formatInr } from '@/lib/format/money';

/** Displays a backend-provided INR amount (paise). Never computes amounts. */
export function Money({ amountMinor }: { amountMinor: number }) {
  return <span className="tabular-nums">{formatInr(amountMinor)}</span>;
}
