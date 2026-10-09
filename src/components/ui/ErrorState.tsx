import type { ReactNode } from 'react';
import { StatePanel } from './StatePanel';

type ErrorStateProps = {
  title?: string;
  message: string;
  requestId?: string | undefined;
  action?: ReactNode;
  /** `h1` when the error replaces the whole page (route error boundaries). */
  headingLevel?: 'h1' | 'h2';
};

/** User-facing error. Shows a safe message and, if present, the request ID for support. */
export function ErrorState({
  title = "We couldn't load this",
  message,
  requestId,
  action,
  headingLevel,
}: ErrorStateProps) {
  return (
    <StatePanel
      tone="danger"
      role="alert"
      headingLevel={headingLevel}
      title={title}
      description={
        <>
          <p>{message}</p>
          {requestId ? <p className="mt-1 font-mono text-xs">Reference: {requestId}</p> : null}
        </>
      }
      action={action}
    />
  );
}
