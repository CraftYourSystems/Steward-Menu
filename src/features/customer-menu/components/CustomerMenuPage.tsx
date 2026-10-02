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
          <span className="text-sm text-text-muted tabular-nums">{count} in cart</span>
        ) : null}
        <Button
          aria-label={`Add ${item.name}`}
          disabled={changes.isPending}
          onClick={() => changes.add(item.id)}
        >
          Add
        </Button>
      </div>
    );
  };

  return (
    <>
      {hasDishes ? (
        <div className="mb-6">
          <label htmlFor="menu-search" className="mb-1 block text-sm font-medium text-text">
            Search dishes
          </label>
          <input
            id="menu-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Dish name"
            autoComplete="off"
            className="min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text"
          />
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

function MenuLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the menu…</p>
      <div className="mt-8 space-y-4">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
