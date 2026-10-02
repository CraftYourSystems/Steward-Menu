import Link from 'next/link';
import { Money } from '@/components/ui/Money';
import type { Cart } from '../schemas';

/** The cart at a glance on the menu: the server's item count and subtotal, and a link to the cart. */
export function CartSummary({ cart, cartHref }: { cart: Cart; cartHref: string }) {
  if (cart.lines.length === 0) return null;
  const items = cart.itemCount === 1 ? '1 item' : `${cart.itemCount} items`;
  return (
    <section
      aria-label="Your cart"
      className="sticky bottom-0 mt-8 flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
    >
      <p className="text-sm text-text">
        <span className="font-medium">{items}</span>
        <span className="text-text-muted"> · </span>
        <Money amountMinor={cart.subtotalMinor} />
      </p>
      <Link
        href={cartHref}
        className="inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-contrast hover:opacity-90"
      >
        View cart
      </Link>
    </section>
  );
}
