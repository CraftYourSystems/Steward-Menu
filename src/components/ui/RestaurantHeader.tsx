/**
 * The prototype's menu header: a full-width glass bar with a Teal line on top,
 * the restaurant name in the display face and the table as a chip. It bleeds
 * to the edges of `<main>` (whose padding it cancels).
 */
export function RestaurantHeader({
  restaurantName,
  tableNumber,
  eyebrow,
}: {
  restaurantName: string;
  tableNumber: number | string;
  /** The small label above the name (the prototype's "Welcome to" on the menu). */
  eyebrow?: string;
}) {
  return (
    <header className="relative -mx-5 -mt-6 mb-6 flex items-start justify-between gap-4 border-b border-glass-border bg-glass px-5 pt-6 pb-5 shadow-glass backdrop-blur-lg before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-brand">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-0.5 text-[0.625rem] font-semibold tracking-eyebrow text-brand uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl leading-[1.1] font-bold tracking-display break-words text-text">
          {restaurantName}
        </h1>
      </div>
      <p className="shrink-0 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand">
        Table {tableNumber}
      </p>
    </header>
  );
}
