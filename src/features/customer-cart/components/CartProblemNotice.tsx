import { Button } from '@/components/ui/Button';
import { cartProblemMessage, type CartProblem } from '../cart-problem';

/** The outcome of a failed cart change. */
export function CartProblemNotice({
  problem,
  onDismiss,
}: {
  problem: CartProblem | null;
  onDismiss: () => void;
}) {
  const message = problem ? cartProblemMessage(problem) : null;
  if (!problem || !message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-danger bg-danger-subtle px-4 py-3"
    >
      <div className="text-sm text-text">
        <p>{message}</p>
        {problem.kind === 'error' && problem.requestId ? (
          <p className="mt-1 font-mono text-xs text-text-muted">Reference: {problem.requestId}</p>
        ) : null}
      </div>
      <Button variant="secondary" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
