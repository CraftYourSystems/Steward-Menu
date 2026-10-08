type SkeletonProps = { className?: string };

/**
 * Decorative placeholder; the loading region itself carries `aria-busy`.
 * The pulse runs only when the user has not asked for reduced motion.
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-2xl bg-border motion-safe:animate-pulse ${className}`}
    />
  );
}
