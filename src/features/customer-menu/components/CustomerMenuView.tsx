import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Money } from '@/components/ui/Money';
import type { CustomerMenu, CustomerMenuItem } from '../schemas';

/** Heading of the group of available items that have no category (TD-7). */
export const UNCATEGORIZED_HEADING = 'Other dishes';

/**
 * The customer menu, as returned by the backend: categories in its order, then
 * available uncategorized items. `renderAction` adds the cart control of each
 * item (S2); `empty` replaces the default empty state (for a search with no match).
 */
export function CustomerMenuView({
  menu,
  renderAction,
  empty,
}: {
  menu: CustomerMenu;
  renderAction?: (item: CustomerMenuItem) => ReactNode;
  empty?: ReactNode;
}) {
  const sections = [
    ...menu.categories.map((category) => ({
      key: category.id,
      title: category.name,
      items: category.items,
    })),
    ...(menu.uncategorized.length > 0
      ? [{ key: 'uncategorized', title: UNCATEGORIZED_HEADING, items: menu.uncategorized }]
      : []),
  ];

  if (sections.length === 0) {
    return (
      empty ?? (
        <EmptyState
          title="The menu isn't available yet"
          description="Please ask a member of staff for help."
        />
      )
    );
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        // The prototype's full-width rows: the section cancels `<main>`'s side padding.
        <section
          key={section.key}
          aria-labelledby={`menu-section-${section.key}`}
          className="-mx-5"
        >
          <h2
            id={`menu-section-${section.key}`}
            className="mb-4 px-5 text-xl leading-tight font-bold tracking-tight break-words text-text"
          >
            {section.title}
          </h2>
          <ul className="divide-y divide-border border-y border-border bg-surface">
            {section.items.map((item) => (
              <MenuItemRow key={item.id} item={item} action={renderAction?.(item)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MenuItemRow({ item, action }: { item: CustomerMenuItem; action: ReactNode }) {
  return (
    <li className="px-5 py-5">
      <p className="font-semibold tracking-tight break-words text-text">{item.name}</p>
      {item.preparationTimeMinutes !== null ? (
        <p className="mt-1 text-xs text-text-muted">
          <span className="sr-only">Approximate preparation time: </span>~
          {item.preparationTimeMinutes} min
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold tracking-tight text-text">
          <Money amountMinor={item.basePriceMinor} />
        </p>
        {action}
      </div>
    </li>
  );
}
