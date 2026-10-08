import { CART_LINE_MAX_QUANTITY } from '../schemas';

/**
 * − / quantity / + for one dish. Decreasing from 1 removes the line (a line
 * never holds 0). The quantity shown is always the server's.
 */
export function QuantityControl({
  name,
  quantity,
  disabled,
  canIncrease,
  onDecrease,
  onIncrease,
}: {
  name: string;
  quantity: number;
  disabled: boolean;
  /** False for an unavailable dish: its quantity may only go down. */
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  // The prototype's quantity control: one Teal-outlined group, − and a filled +.
  return (
    <div
      role="group"
      aria-label={`${name} quantity`}
      className="flex items-center rounded-xl border-[1.5px] border-brand bg-surface"
    >
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-l-[10.5px] text-lg font-bold text-brand hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={`Decrease ${name}`}
        disabled={disabled}
        onClick={onDecrease}
      >
        −
      </button>
      <span
        className="min-w-8 text-center text-sm font-bold text-text tabular-nums"
        aria-live="polite"
      >
        <span className="sr-only">Quantity </span>
        {quantity}
      </span>
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-r-[10.5px] bg-brand text-lg font-bold text-brand-contrast disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={`Increase ${name}`}
        disabled={disabled || !canIncrease || quantity >= CART_LINE_MAX_QUANTITY}
        onClick={onIncrease}
      >
        +
      </button>
    </div>
  );
}
