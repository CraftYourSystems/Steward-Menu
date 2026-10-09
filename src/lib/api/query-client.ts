import { QueryClient } from '@tanstack/react-query';
import { isRetryable } from './errors';

const MAX_RETRIES = 2;

/**
 * The customer application's server-state cache. It has no 401 handler: a
 * customer 401 means the table session ended and is handled by the customer
 * page itself (F-01 technical design §6, §29). Customers never sign in, so
 * nothing here ever navigates to a sign-in page.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => failureCount < MAX_RETRIES && isRetryable(error),
      },
      // Writes are never retried automatically: a write that timed out may
      // still have been applied.
      mutations: { retry: 0 },
    },
  });
}
