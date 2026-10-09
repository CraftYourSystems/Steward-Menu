import Link from 'next/link';
import { Money } from '@/components/ui/Money';
import type { Cart } from '../schemas';

/**
 * The cart at a glance on the menu: the server's item count and subtotal, and a
 * link to the cart, as the prototype's floating Teal capsule. The link covers
 * the whole capsule, so the bar is one tap target.
 */
export function CartSummary({ cart, cartHref }: { cart: Cart; cartHref: string }) {
  if (cart.lines.length === 0) return null;
  const items = cart.itemCount === 1 ? '1 item' : `${cart.itemCount} items`;
  return (
    <section
      aria-label="Your cart"
      className="sticky bottom-4 mt-8 flex items-center justify-between gap-4 rounded-3xl border border-brand-border bg-brand bg-gradient-brand px-5 py-4 text-text-inverse shadow-bar motion-safe:animate-bar-in"
    >
      <p className="text-sm">
        <span className="rounded-full border border-glass-on-brand-border px-2 py-0.5 text-xs font-bold">
          {items}
        </span>
        <span> · </span>
        <span className="text-lg font-bold tracking-tight">
          <Money amountMinor={cart.subtotalMinor} />
        </span>
      </p>
      <Link
        href={cartHref}
        className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold after:absolute after:inset-0 after:rounded-3xl"
      >
        View cart
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
