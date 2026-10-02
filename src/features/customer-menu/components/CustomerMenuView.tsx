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
        <section key={section.key} aria-labelledby={`menu-section-${section.key}`}>
          <h2
            id={`menu-section-${section.key}`}
            className="border-b border-border pb-2 text-lg font-semibold text-text"
          >
            {section.title}
          </h2>
          <ul className="divide-y divide-border">
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
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-medium break-words text-text">{item.name}</p>
        {item.preparationTimeMinutes !== null ? (
          <p className="mt-1 text-sm text-text-muted">
            <span className="sr-only">Approximate preparation time: </span>~
            {item.preparationTimeMinutes} min
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className="font-medium text-text">
          <Money amountMinor={item.basePriceMinor} />
        </p>
        {action}
      </div>
    </li>
  );
}
