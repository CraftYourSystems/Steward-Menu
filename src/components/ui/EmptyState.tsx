import type { ReactNode } from 'react';
import { StatePanel } from './StatePanel';

type EmptyStateProps = { title: string; description?: ReactNode; action?: ReactNode };

/** Empty data is not an error (CLAUDE.md §18). */
export function EmptyState(props: EmptyStateProps) {
  return <StatePanel {...props} role="status" />;
}
