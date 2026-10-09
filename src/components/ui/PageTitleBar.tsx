import Link from 'next/link';

/**
 * The prototype's top bar: a round back button, the page title in the middle.
 * The back control stays a link with a spoken name ("Back to menu").
 */
export function PageTitleBar({
  id,
  title,
  back,
}: {
  /** The heading's id, for the page section's `aria-labelledby`. */
  id: string;
  title: string;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3">
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-text shadow-xs transition-transform hover:bg-brand-surface motion-safe:active:scale-90"
        >
          <span aria-hidden="true">←</span>
        </Link>
      ) : (
        <span />
      )}
      <h2 id={id} className="text-center text-base font-bold tracking-tight text-text">
        {title}
      </h2>
      <span />
    </div>
  );
}
