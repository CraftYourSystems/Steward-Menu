import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Money } from './Money';
import { Skeleton } from './Skeleton';

describe('state components', () => {
  it('EmptyState is a status, not an alert', () => {
    render(<EmptyState title="The menu isn't available yet" />);
    expect(screen.getByRole('status')).toHaveTextContent("The menu isn't available yet");
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ErrorState shows the safe message and request reference', () => {
    render(
      <ErrorState message="Something went wrong on our side. Try again." requestId="req-42" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side. Try again.');
    expect(alert).toHaveTextContent('Reference: req-42');
  });
});

describe('Skeleton', () => {
  it('pulses only when the user has not asked for reduced motion', () => {
    const { container } = render(<Skeleton className="h-4" />);
    const skeleton = container.firstElementChild;
    expect(skeleton).toHaveClass('motion-safe:animate-pulse');
    expect(skeleton).not.toHaveClass('animate-pulse');
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('display primitives', () => {
  it('Money renders backend paise as INR', () => {
    render(<Money amountMinor={24_900} />);
    expect(screen.getByText('₹249.00')).toBeInTheDocument();
  });
});
