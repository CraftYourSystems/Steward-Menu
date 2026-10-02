'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CartProblemNotice } from '@/features/customer-cart/components/CartProblemNotice';
import { CartSummary } from '@/features/customer-cart/components/CartSummary';
import { QuantityControl } from '@/features/customer-cart/components/QuantityControl';
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
 * `/t/[qrCode]` (F-01 S1, S2): the session restaurant's menu, searchable by
 * dish name, with Add and quantity controls backed by the server-side cart.
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
  const lineFor = new Map<string, CartLine>(
    (cart.data?.lines ?? []).map((line) => [line.menuItemId, line]),
  );

  const renderAction = (item: CustomerMenuItem) => {
    const line = lineFor.get(item.id);
    if (!line) {
      return (
        <Button
          aria-label={`Add ${item.name}`}
          disabled={changes.isPending}
          onClick={() => changes.add(item.id)}
        >
          Add
        </Button>
      );
    }
    return (
      <QuantityControl
        name={item.name}
        quantity={line.quantity}
        disabled={changes.isPending}
        canIncrease={line.available}
        onDecrease={() =>
          line.quantity > 1
            ? changes.setQuantity(line.id, line.quantity - 1)
            : changes.remove(line.id)
        }
        onIncrease={() => changes.add(item.id)}
      />
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
