'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { ApiError, userMessageFor } from '@/lib/api/errors';

type ErrorBoundaryProps = { error: Error & { digest?: string }; reset: () => void };

/**
 * App-level error boundary, so an unexpected failure renders as a Steward
 * error state instead of the framework's unstyled default. Customer API
 * failures are handled by the pages themselves; this is the last resort.
 */
export default function AppError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      headingLevel="h1"
      title="We couldn't open the menu"
      message={userMessageFor(error)}
      requestId={error instanceof ApiError ? error.requestId : error.digest}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
