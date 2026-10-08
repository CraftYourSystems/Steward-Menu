'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { PageTitleBar } from '@/components/ui/PageTitleBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { StickyFooter } from '@/components/ui/StickyFooter';
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
      <PageTitleBar
        id="cart-title"
        title="Your cart"
        back={{ href: base, label: 'Back to menu' }}
      />

      {availabilityChanged && hasUnavailable ? (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-danger bg-danger-subtle px-4 py-3"
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
              <Skeleton key={row} className="h-24 w-full" />
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
            <Link href={base} className={buttonClasses('primary')}>
              Browse the menu
            </Link>
          }
        />
      ) : (
        <>
          <ul className="-mx-5 divide-y divide-border border-y border-border bg-surface px-5">
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
          <div className="mt-6 rounded-3xl bg-surface px-5 py-5 shadow-sm">
            <p className="flex items-center justify-between text-lg font-bold tracking-tight text-text">
              <span>Subtotal</span>
              <Money amountMinor={cart.data.subtotalMinor} />
            </p>
            {hasUnavailable ? (
              <p className="mt-1 text-sm text-text-muted">Unavailable dishes are not included.</p>
            ) : null}
          </div>
          <StickyFooter>
            {hasUnavailable ? (
              <p className="text-center text-sm text-text-muted">
                Remove unavailable dishes to continue.
              </p>
            ) : (
              <Link href={`${base}/details`} className={`${buttonClasses('primary')} w-full`}>
                Continue
              </Link>
            )}
          </StickyFooter>
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
    <li className="py-5" aria-label={label}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words text-text">{line.name}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            <Money amountMinor={line.unitPriceMinor} /> each
          </p>
          {line.specialInstructions && !editing ? (
            <p className="mt-1 text-xs break-words text-text-muted italic">
              Note: {line.specialInstructions}
            </p>
          ) : null}
          {line.available ? null : (
            <p className="mt-1 text-sm font-medium text-danger">
              Unavailable — this dish can&apos;t be ordered right now. Remove it to continue.
            </p>
          )}
        </div>
        <p
          className={`shrink-0 text-sm font-bold ${line.available ? 'text-text' : 'text-text-muted line-through'}`}
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
              variant="soft"
              size="sm"
              aria-label={`${line.specialInstructions ? 'Edit' : 'Add'} instructions for ${label}`}
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              {line.specialInstructions ? 'Edit note' : 'Add note'}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
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
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-text">
        Instructions for {label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={SPECIAL_INSTRUCTIONS_MAX_LENGTH}
        rows={2}
        aria-describedby={`${id}-hint`}
        className="w-full resize-none rounded-xl border-[1.5px] border-border-strong bg-surface px-4 py-3 text-base text-text focus:border-brand focus:shadow-ring-brand"
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-text-muted">
        For example &quot;no onion&quot;. Up to {SPECIAL_INSTRUCTIONS_MAX_LENGTH} characters; it
        doesn&apos;t change the price.
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          Save note
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
