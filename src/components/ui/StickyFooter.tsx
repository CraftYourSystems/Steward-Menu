import type { ReactNode } from 'react';

/**
 * The prototype's glass footer dock: the page's next step stays in reach at
 * the bottom of the screen. It bleeds to the edges of `<main>`.
 */
export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 border-t border-glass-border bg-glass px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-glass backdrop-blur-lg">
      {children}
    </div>
  );
}
