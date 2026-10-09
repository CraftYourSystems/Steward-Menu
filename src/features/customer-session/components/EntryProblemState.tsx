import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatePanel } from '@/components/ui/StatePanel';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import type { EntryProblem } from '../entry-problem';

/** What the customer sees when QR entry did not open the menu. */
export function EntryProblemState({
  problem,
  onRetry,
}: {
  problem: EntryProblem;
  onRetry: () => void;
}) {
  switch (problem.kind) {
    case 'invalid':
      return (
        <StatePanel
          headingLevel="h1"
          title="We couldn't find this table"
          description="Check that you scanned the QR code on your table, or ask a member of staff."
        />
      );
    case 'unavailable':
      return (
        <StatePanel
          headingLevel="h1"
          title="Table unavailable"
          description="This table isn't taking orders right now. Please ask a member of staff."
        />
      );
    case 'other_table':
      return (
        <StatePanel
          headingLevel="h1"
          title={`Your order is at Table ${problem.tableNumber}`}
          description={`You've already started ordering at Table ${problem.tableNumber}. Scan the QR code on that table to continue.`}
        />
      );
    case 'rate_limited':
      return (
        <ErrorState
          headingLevel="h1"
          title="Please wait a moment"
          message={
            problem.retryAfterSeconds
              ? `Too many attempts. Try again in ${problem.retryAfterSeconds} seconds.`
              : 'Too many attempts. Wait a moment and try again.'
          }
          action={<Button onClick={onRetry}>Try again</Button>}
        />
      );
    case 'error':
      return (
        <ErrorState
          headingLevel="h1"
          title="We couldn't open the menu"
          message={userMessageFor(problem.error)}
          requestId={problem.error instanceof ApiError ? problem.error.requestId : undefined}
          action={<Button onClick={onRetry}>Try again</Button>}
        />
      );
  }
}
