'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { Skeleton } from '@/components/ui/Skeleton';
import { isUnauthorized, useCustomerSession } from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { useCart, useCartChanges } from '../hooks';
import type { CartLine } from '../schemas';
import { CartProblemNotice } from './CartProblemNotice';
import { QuantityControl } from './QuantityControl';

/**
 * `/t/[qrCode]/cart` (route map; F-01 S2): the server-side cart with current
 * base prices. Lines whose dish became unavailable stay, clearly marked, and
 * can only be decreased or removed; the subtotal from the server leaves them
 * out. No tax, checkout or customer details here (S3+).
 */
export function CustomerCartPage() {
  const { qrCode } = useCustomerSession();
  const cart = useCart();
  const changes = useCartChanges();
  const menuHref = `/t/${encodeURIComponent(qrCode)}`;

  return (
    <section aria-labelledby="cart-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="cart-title" className="text-lg font-semibold text-text">
          Your cart
        </h2>
        <Link href={menuHref} className="text-sm font-medium text-brand underline">
          Back to menu
        </Link>
      </div>

      <CartProblemNotice problem={changes.problem} onDismiss={changes.clearProblem} />

      {cart.isPending || isUnauthorized(cart.error) ? (
        <div aria-busy="true" aria-live="polite">
          <p className="sr-only">Loading your cart…</p>
          <div className="space-y-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ) : cart.isError ? (
        <ErrorState
          title="We couldn't load your cart"
          message={userMessageFor(cart.error)}
          requestId={cart.error instanceof ApiError ? cart.error.requestId : undefined}
          action={<Button onClick={() => void cart.refetch()}>Try again</Button>}
        />
      ) : cart.data.lines.length === 0 ? (
        <EmptyState
          title="Your cart is empty"
          description="Add dishes from the menu to start your order."
          action={
            <Link
              href={menuHref}
              className="inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-contrast hover:opacity-90"
            >
              Browse the menu
            </Link>
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {cart.data.lines.map((line) => (
              <CartLineRow
                key={line.id}
                line={line}
                disabled={changes.isPending}
                onSetQuantity={(quantity) => changes.setQuantity(line.id, quantity)}
                onRemove={() => changes.remove(line.id)}
              />
            ))}
          </ul>
          <div className="mt-6 border-t border-border pt-4">
            <p className="flex items-center justify-between text-base font-semibold text-text">
              <span>Subtotal</span>
              <Money amountMinor={cart.data.subtotalMinor} />
            </p>
            {cart.data.lines.some((line) => !line.available) ? (
              <p className="mt-1 text-sm text-text-muted">Unavailable dishes are not included.</p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function CartLineRow({
  line,
  disabled,
  onSetQuantity,
  onRemove,
}: {
  line: CartLine;
  disabled: boolean;
  onSetQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="py-4" aria-label={line.name}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium break-words text-text">{line.name}</p>
          <p className="mt-1 text-sm text-text-muted">
            <Money amountMinor={line.unitPriceMinor} /> each
          </p>
          {line.available ? null : (
            <p className="mt-1 text-sm font-medium text-danger">
              Unavailable — this dish can&apos;t be ordered right now. Remove it to continue.
            </p>
          )}
        </div>
        <p
          className={`shrink-0 font-medium ${line.available ? 'text-text' : 'text-text-muted line-through'}`}
        >
          <span className="sr-only">{line.available ? 'Line total ' : 'Not included: '}</span>
          <Money amountMinor={line.lineTotalMinor} />
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-4">
        <QuantityControl
          name={line.name}
          quantity={line.quantity}
          disabled={disabled}
          canIncrease={line.available}
          onDecrease={() => (line.quantity > 1 ? onSetQuantity(line.quantity - 1) : onRemove())}
          onIncrease={() => onSetQuantity(line.quantity + 1)}
        />
        <Button
          variant="secondary"
          aria-label={`Remove ${line.name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}
