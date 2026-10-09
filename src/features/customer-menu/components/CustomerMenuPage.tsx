'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CartProblemNotice } from '@/features/customer-cart/components/CartProblemNotice';
import { CartSummary } from '@/features/customer-cart/components/CartSummary';
import { useCart, useCartChanges } from '@/features/customer-cart/hooks';
import type { CartLine } from '@/features/customer-cart/schemas';
import { customerKeys } from '@/features/customer-session/query-keys';
import {
  isUnauthorized,
  useCustomerSession,
  useSessionOutcome,
} from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { fetchCustomerMenu } from '../api';
import type { CustomerMenuItem } from '../schemas';
import { filterMenuByName } from '../search';
import { CustomerMenuView } from './CustomerMenuView';

/**
 * `/t/[qrCode]` (F-01 S1 to S3): the session restaurant's menu, searchable by
 * dish name. Add puts one more of a dish (without instructions) in the
 * server-side cart; "N in cart" shows how many the cart holds. Quantities and
 * instructions of each line are changed on the cart page.
 */
export function CustomerMenuPage() {
  const { qrCode } = useCustomerSession();
  const menu = useQuery({
    queryKey: customerKeys.menu(qrCode),
    queryFn: ({ signal }) => fetchCustomerMenu({ signal }),
    retry: (failureCount, error) =>
      !isUnauthorized(error) &&
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
  });
  useSessionOutcome(menu);
  const cart = useCart();
  const changes = useCartChanges();
  const [search, setSearch] = useState('');

  if (menu.isPending || isUnauthorized(menu.error)) return <MenuLoading />;
  if (menu.isError) {
    return (
      <ErrorState
        title="We couldn't load the menu"
        message={userMessageFor(menu.error)}
        requestId={menu.error instanceof ApiError ? menu.error.requestId : undefined}
        action={<Button onClick={() => void menu.refetch()}>Try again</Button>}
      />
    );
  }

  const hasDishes = menu.data.categories.length > 0 || menu.data.uncategorized.length > 0;
  const inCart = quantitiesByDish(cart.data?.lines ?? []);

  // A dish may have several cart lines (different instructions, S3). The menu
  // adds to the line without instructions; each line is changed on the cart page.
  const renderAction = (item: CustomerMenuItem) => {
    const count = inCart.get(item.id) ?? 0;
    return (
      <div className="flex items-center gap-3">
        {count > 0 ? (
          <span className="rounded-full bg-brand-surface px-2.5 py-1 text-xs font-semibold text-brand tabular-nums">
            {count} in cart
          </span>
        ) : null}
        <Button
          variant="soft"
          size="sm"
          className="gap-1"
          aria-label={`Add ${item.name}`}
          disabled={changes.isPending}
          onClick={() => changes.add(item.id)}
        >
          <span aria-hidden="true">+</span>
          Add
        </Button>
      </div>
    );
  };

  return (
    <>
      {hasDishes ? (
        <div className="mb-6">
          <label htmlFor="menu-search" className="sr-only">
            Search dishes
          </label>
          {/* The prototype's glass capsule; the focus outline moves to the capsule. */}
          <div className="flex items-center gap-3 rounded-3xl border border-glass-border bg-surface px-4 py-3 shadow-glass focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
            <SearchIcon />
            <input
              id="menu-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search dishes by name"
              autoComplete="off"
              className="min-h-6 w-full bg-transparent text-base font-medium text-text placeholder:font-normal placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
        </div>
      ) : null}
      <CartProblemNotice problem={changes.problem} onDismiss={changes.clearProblem} />
      <CustomerMenuView
        menu={filterMenuByName(menu.data, search)}
        renderAction={renderAction}
        empty={
          hasDishes ? (
            <EmptyState title="No dishes match" description="Try another dish name." />
          ) : undefined
        }
      />
      {cart.data ? (
        <CartSummary cart={cart.data} cartHref={`/t/${encodeURIComponent(qrCode)}/cart`} />
      ) : null}
    </>
  );
}

/** How many of each dish the server's cart holds, across its lines (a display count, not a price). */
function quantitiesByDish(lines: CartLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.menuItemId, (counts.get(line.menuItemId) ?? 0) + line.quantity);
  }
  return counts;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-4 shrink-0 text-text-muted"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m14 14 4 4" />
    </svg>
  );
}

function MenuLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the menu…</p>
      <Skeleton className="h-12 w-full rounded-3xl" />
      <div className="mt-8 space-y-4">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
