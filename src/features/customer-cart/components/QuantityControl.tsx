import { Button } from '@/components/ui/Button';
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
  return (
    <div role="group" aria-label={`${name} quantity`} className="flex items-center gap-2">
      <Button
        variant="secondary"
        className="min-w-10 px-0"
        aria-label={`Decrease ${name}`}
        disabled={disabled}
        onClick={onDecrease}
      >
        −
      </Button>
      <span className="min-w-6 text-center font-medium tabular-nums" aria-live="polite">
        <span className="sr-only">Quantity </span>
        {quantity}
      </span>
      <Button
        variant="secondary"
        className="min-w-10 px-0"
        aria-label={`Increase ${name}`}
        disabled={disabled || !canIncrease || quantity >= CART_LINE_MAX_QUANTITY}
        onClick={onIncrease}
      >
        +
      </Button>
    </div>
  );
}
