'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/lib/api/query-client';

/**
 * The customer application's query client. A customer 401 means the customer
 * session ended; CustomerEntry re-enters the session itself, and nothing ever
 * redirects a customer to a sign-in page (F-01 technical design §6, §29).
 */
export function CustomerQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
