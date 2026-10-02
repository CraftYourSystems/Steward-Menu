import type { ReactNode } from 'react';

type StatePanelProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
  role?: 'status' | 'alert';
  /** `h1` when the panel is the whole page (forbidden, not found). */
  headingLevel?: 'h1' | 'h2';
};

/** Shared layout for empty, error and forbidden states. */
export function StatePanel({
  title,
  description,
  action,
  tone = 'neutral',
  role,
  headingLevel: Heading = 'h2',
}: StatePanelProps) {
  const toneClasses =
    tone === 'danger' ? 'border-danger bg-danger-subtle' : 'border-border bg-surface-muted';

  return (
    <section role={role} className={`rounded-lg border px-6 py-10 text-center ${toneClasses}`}>
      <Heading
        className={`text-base font-semibold ${tone === 'danger' ? 'text-danger' : 'text-text'}`}
      >
        {title}
      </Heading>
      {description ? <div className="mt-2 text-sm text-text-muted">{description}</div> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </section>
  );
}
