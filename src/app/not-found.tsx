import { StatePanel } from '@/components/ui/StatePanel';

/** Generic: reveals nothing about whether a restaurant or table exists (F-04 §11, §13). */
export default function NotFound() {
  return (
    <StatePanel
      headingLevel="h1"
      title="Page not found"
      description="Scan the QR code on your table to see the menu."
    />
  );
}
