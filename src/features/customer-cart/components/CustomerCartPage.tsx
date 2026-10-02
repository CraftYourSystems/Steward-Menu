'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { Skeleton } from '@/components/ui/Skeleton';
import { isUnauthorized, useCustomerSession } from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { useCart, useCartChanges } from '../hooks';
import { SPECIAL_INSTRUCTIONS_MAX_LENGTH, type CartLine } from '../schemas';
import { CartProblemNotice } from './CartProblemNotice';
import { QuantityControl } from './QuantityControl';

/** A line's name for controls and screen readers: lines of one dish differ by instructions. */
export function lineLabel(line: CartLine): string {
  return line.specialInstructions ? `${line.name} (${line.specialInstructions})` : line.name;
}

/**
 * `/t/[qrCode]/cart` (route map; F-01 S2, S3): the server-side cart with current
 * base prices. A dish can have several lines, one per set of special
 * instructions; each line's quantity and instructions are changed here.
 * Instructions are plain text and never change a price. Lines whose dish
 * became unavailable stay, clearly marked, and must be removed before
 * continuing to details and review.
 */
export function CustomerCartPage() {
  const { qrCode } = useCustomerSession();
  const cart = useCart();
  const changes = useCartChanges();
  const availabilityChanged = useSearchParams().get('changed') === 'availability';
  const base = `/t/${encodeURIComponent(qrCode)}`;
  const hasUnavailable = cart.data?.lines.some((line) => !line.available) ?? false;

  return (
    <section aria-labelledby="cart-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="cart-title" className="text-lg font-semibold text-text">
          Your cart
        </h2>
        <Link href={base} className="text-sm font-medium text-brand underline">
          Back to menu
        </Link>
      </div>

      {availabilityChanged && hasUnavailable ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-danger bg-danger-subtle px-4 py-3"
        >
          <p className="text-sm text-text">
            Some dishes in your cart are no longer available. Remove them, then review your order
            again.
          </p>
        </div>
      ) : null}

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
              href={base}
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
                onSetInstructions={(text) => changes.setInstructions(line.id, text)}
                onRemove={() => changes.remove(line.id)}
              />
            ))}
          </ul>
          <div className="mt-6 border-t border-border pt-4">
            <p className="flex items-center justify-between text-base font-semibold text-text">
              <span>Subtotal</span>
              <Money amountMinor={cart.data.subtotalMinor} />
            </p>
            {hasUnavailable ? (
              <p className="mt-1 text-sm text-text-muted">Unavailable dishes are not included.</p>
            ) : null}
          </div>
          <div className="mt-6">
            {hasUnavailable ? (
              <p className="text-sm text-text-muted">Remove unavailable dishes to continue.</p>
            ) : (
              <Link
                href={`${base}/details`}
                className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-contrast hover:opacity-90"
              >
                Continue
              </Link>
            )}
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
  onSetInstructions,
  onRemove,
}: {
  line: CartLine;
  disabled: boolean;
  onSetQuantity: (quantity: number) => void;
  onSetInstructions: (text: string | null) => void;
  onRemove: () => void;
}) {
  const label = lineLabel(line);
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-4" aria-label={label}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium break-words text-text">{line.name}</p>
          <p className="mt-1 text-sm text-text-muted">
            <Money amountMinor={line.unitPriceMinor} /> each
          </p>
          {line.specialInstructions && !editing ? (
            <p className="mt-1 text-sm break-words text-text">Note: {line.specialInstructions}</p>
          ) : null}
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
      {editing ? (
        <InstructionsForm
          label={label}
          initial={line.specialInstructions ?? ''}
          disabled={disabled}
          onSave={(text) => {
            onSetInstructions(text.trim() ? text : null);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <QuantityControl
          name={label}
          quantity={line.quantity}
          disabled={disabled}
          canIncrease={line.available}
          onDecrease={() => (line.quantity > 1 ? onSetQuantity(line.quantity - 1) : onRemove())}
          onIncrease={() => onSetQuantity(line.quantity + 1)}
        />
        <div className="flex gap-2">
          {editing ? null : (
            <Button
              variant="secondary"
              aria-label={`${line.specialInstructions ? 'Edit' : 'Add'} instructions for ${label}`}
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              {line.specialInstructions ? 'Edit note' : 'Add note'}
            </Button>
          )}
          <Button
            variant="secondary"
            aria-label={`Remove ${label}`}
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

function InstructionsForm({
  label,
  initial,
  disabled,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  disabled: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const id = `instructions-${label.replace(/\W+/g, '-')}`;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave(text);
  };
  return (
    <form onSubmit={onSubmit} className="mt-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text">
        Instructions for {label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={SPECIAL_INSTRUCTIONS_MAX_LENGTH}
        rows={2}
        aria-describedby={`${id}-hint`}
        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-text"
      />
      <p id={`${id}-hint`} className="mt-1 text-sm text-text-muted">
        For example &quot;no onion&quot;. Up to {SPECIAL_INSTRUCTIONS_MAX_LENGTH} characters; it
        doesn&apos;t change the price.
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="submit" disabled={disabled}>
          Save note
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
