'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatePanel } from '@/components/ui/StatePanel';
import { customerKeys } from '@/features/customer-session/query-keys';
import {
  isUnauthorized,
  useCustomerSession,
  useSessionOutcome,
} from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { leaveForPayment } from '@/lib/navigation';
import { fetchCheckout, initiatePayment, reviewOrder } from '../api';
import {
  CANT_TAKE_ORDERS,
  paymentProblemFor,
  rateLimitedMessage,
  TALK_TO_STAFF,
  type PaymentProblem,
} from '../payment-problem';
import { reviewProblemFor, type ReviewProblem } from '../review-problem';
import type { Checkout } from '../schemas';
import type { PaymentNotice } from './PaymentReturnPage';

/**
 * `/t/[qrCode]/checkout` (route map; F-01 S3): the review step. It shows the
 * session's open checkout exactly as the backend priced it: details, table,
 * line snapshots, subtotal, tax and total. Loading the page never creates a
 * checkout; Review runs only when the customer asks for it.
 *
 * **Pay** (S4) asks the backend to start the payment of the reviewed checkout
 * and sends the browser to the returned gateway URL. The backend first checks
 * the order against current data: a dish that became unavailable sends the
 * customer to the cart, a changed price or tax rate back to Review, an inactive
 * table to staff. The amount is never sent: the backend charges the locked total.
 */
export function CustomerCheckoutPage() {
  const { qrCode, reportSessionEnded, reportSessionWorking, reportSessionStage } =
    useCustomerSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [problem, setProblem] = useState<ReviewProblem | null>(null);
  const [payProblem, setPayProblem] = useState<PaymentProblem | null>(null);
  const base = `/t/${encodeURIComponent(qrCode)}`;

  const checkout = useQuery({
    queryKey: customerKeys.checkout(qrCode),
    queryFn: ({ signal }) => fetchCheckout({ signal }),
    retry: (failureCount, error) =>
      !isUnauthorized(error) &&
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
  });
  useSessionOutcome(checkout);

  const review = useMutation({
    mutationFn: reviewOrder,
    onMutate: () => {
      setProblem(null);
      setPayProblem(null);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(customerKeys.checkout(qrCode), result);
      reportSessionWorking();
    },
    onError: (error) => {
      const next = reviewProblemFor(error);
      if (next.kind === 'session_ended') {
        reportSessionEnded();
        return;
      }
      if (next.kind === 'revalidation') {
        void queryClient.invalidateQueries({ queryKey: customerKeys.cart(qrCode) });
        void queryClient.invalidateQueries({ queryKey: customerKeys.menu(qrCode) });
        router.push(`${base}/cart?changed=availability`);
        return;
      }
      if (next.kind === 'cart_empty') {
        router.push(`${base}/cart`);
        return;
      }
      if (next.kind === 'details_required') {
        router.push(`${base}/details`);
        return;
      }
      if (next.kind === 'cart_locked') {
        reportSessionStage('payment'); // the session boundary takes the customer to payment
        return;
      }
      setProblem(next);
    },
  });

  /** Payment started and the gateway was involved: the return page takes over. */
  const toPayment = (notice: PaymentNotice | null) => {
    if (notice) queryClient.setQueryData(customerKeys.paymentNotice(qrCode), notice);
    void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });
    reportSessionStage('payment');
  };

  const pay = useMutation({
    mutationFn: (checkoutId: string) => initiatePayment(checkoutId),
    onMutate: () => {
      setProblem(null);
      setPayProblem(null);
    },
    onSuccess: ({ redirectUrl }) => leaveForPayment(redirectUrl),
    onError: (error) => {
      const next = paymentProblemFor(error);
      switch (next.kind) {
        case 'session_ended':
          reportSessionEnded();
          return;
        case 'item_unavailable':
          void queryClient.invalidateQueries({ queryKey: customerKeys.cart(qrCode) });
          void queryClient.invalidateQueries({ queryKey: customerKeys.menu(qrCode) });
          void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });
          router.push(`${base}/cart?changed=availability`);
          return;
        case 'review_again':
        case 'table_unavailable':
          // The backend superseded the checkout: Review is offered again.
          void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });
          setPayProblem(next);
          return;
        case 'gateway_unavailable':
          toPayment('gateway_error');
          return;
        case 'still_confirming':
          toPayment('still_confirming');
          return;
        case 'retry_limit':
          toPayment('retry_limit');
          return;
        case 'cart_locked':
          toPayment(null);
          return;
        default:
          setPayProblem(next);
      }
    },
  });

  return (
    <section aria-labelledby="review-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="review-title" className="text-lg font-semibold text-text">
          Review your order
        </h2>
        <Link href={`${base}/cart`} className="text-sm font-medium text-brand underline">
          Back to cart
        </Link>
      </div>

      <ReviewProblemNotice problem={problem} />
      <PayProblemNotice problem={payProblem} />

      {checkout.isPending || isUnauthorized(checkout.error) ? (
        <div aria-busy="true" aria-live="polite">
          <p className="sr-only">Loading your order…</p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="mt-4 h-16 w-full" />
        </div>
      ) : checkout.isError ? (
        <ErrorState
          title="We couldn't load your order"
          message={userMessageFor(checkout.error)}
          requestId={checkout.error instanceof ApiError ? checkout.error.requestId : undefined}
          action={<Button onClick={() => void checkout.refetch()}>Try again</Button>}
        />
      ) : checkout.data ? (
        <ReviewedOrder
          checkout={checkout.data}
          base={base}
          paying={pay.isPending || pay.isSuccess}
          onPay={(checkoutId) => pay.mutate(checkoutId)}
        />
      ) : (
        <StatePanel
          title="Ready to review?"
          description="We'll check your cart and calculate the total, including tax."
          action={
            <Button disabled={review.isPending} onClick={() => review.mutate()}>
              {review.isPending ? 'Reviewing…' : 'Review order'}
            </Button>
          }
        />
      )}
    </section>
  );
}

function ReviewProblemNotice({ problem }: { problem: ReviewProblem | null }) {
  if (!problem) return null;
  const message = (() => {
    switch (problem.kind) {
      case 'configuration':
        return "This restaurant can't take orders right now. Please ask a member of staff.";
      case 'table_unavailable':
        return "This table isn't taking orders right now. Please ask a member of staff.";
      case 'rate_limited':
        return problem.retryAfterSeconds
          ? `Too many attempts. Please wait ${problem.retryAfterSeconds} seconds and try again.`
          : 'Too many attempts. Please wait a moment and try again.';
      case 'error':
        return problem.message;
      default:
        return null;
    }
  })();
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-danger bg-danger-subtle px-4 py-3">
      <p className="text-sm text-text">{message}</p>
      {problem.kind === 'error' && problem.requestId ? (
        <p className="mt-1 font-mono text-xs text-text-muted">Reference: {problem.requestId}</p>
      ) : null}
    </div>
  );
}

function PayProblemNotice({ problem }: { problem: PaymentProblem | null }) {
  if (!problem) return null;
  const message = (() => {
    switch (problem.kind) {
      case 'review_again':
        if (problem.reason === 'price_changed') {
          return 'Some prices changed since you reviewed your order. Please review it again.';
        }
        if (problem.reason === 'tax_changed') {
          return 'The tax rate changed since you reviewed your order. Please review it again.';
        }
        return 'Your order changed since you reviewed it. Please review it again.';
      case 'table_unavailable':
        return TALK_TO_STAFF;
      case 'configuration':
        return CANT_TAKE_ORDERS;
      case 'rate_limited':
        return rateLimitedMessage(problem.retryAfterSeconds);
      case 'error':
        return problem.message;
      default:
        return null;
    }
  })();
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-danger bg-danger-subtle px-4 py-3">
      <p className="text-sm text-text">{message}</p>
      {problem.kind === 'error' && problem.requestId ? (
        <p className="mt-1 font-mono text-xs text-text-muted">Reference: {problem.requestId}</p>
      ) : null}
    </div>
  );
}

type ReviewedOrderProps = {
  checkout: Checkout;
  base: string;
  paying: boolean;
  onPay: (checkoutId: string) => void;
};

function ReviewedOrder({ checkout, base, paying, onPay }: ReviewedOrderProps) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="review-customer" className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <h3 id="review-customer" className="text-sm font-semibold text-text">
            Your details
          </h3>
          <Link href={`${base}/details`} className="text-sm font-medium text-brand underline">
            Change
          </Link>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-muted">Name</dt>
          <dd className="text-text">{checkout.customerName}</dd>
          <dt className="text-text-muted">Mobile</dt>
          <dd className="text-text tabular-nums">{checkout.mobileDisplay}</dd>
          <dt className="text-text-muted">Table</dt>
          <dd className="text-text">{checkout.tableNumber}</dd>
        </dl>
      </section>

      <section aria-labelledby="review-items">
        <h3 id="review-items" className="text-sm font-semibold text-text">
          Your order
        </h3>
        <ul className="mt-2 divide-y divide-border">
          {checkout.lines.map((line, index) => (
            <li key={index} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="font-medium break-words text-text">
                  {line.quantity} × {line.name}
                </p>
                <p className="text-sm text-text-muted">
                  <Money amountMinor={line.unitPriceMinor} /> each
                </p>
                {line.specialInstructions ? (
                  <p className="mt-1 text-sm break-words text-text-muted">
                    Note: {line.specialInstructions}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 font-medium text-text">
                <Money amountMinor={line.lineTotalMinor} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Amounts" className="border-t border-border pt-4">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">Subtotal</dt>
            <dd className="text-text">
              <Money amountMinor={checkout.subtotalMinor} />
            </dd>
          </div>
          {checkout.taxes.map((tax, index) => (
            <div key={index} className="flex justify-between">
              <dt className="text-text-muted">{tax.label}</dt>
              <dd className="text-text">
                <Money amountMinor={tax.amountMinor} />
              </dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt className="text-text">Total</dt>
            <dd className="text-text">
              <Money amountMinor={checkout.totalMinor} />
            </dd>
          </div>
        </dl>
      </section>

      {checkout.status === 'open' ? (
        <Button className="w-full" disabled={paying} onClick={() => onPay(checkout.checkoutId)}>
          {paying ? 'Opening payment…' : 'Pay'}
        </Button>
      ) : null}
    </div>
  );
}
