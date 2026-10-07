'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatePanel } from '@/components/ui/StatePanel';
import { orderPagePath } from '@/features/customer-order/paths';
import { customerKeys } from '@/features/customer-session/query-keys';
import {
  isUnauthorized,
  useCustomerSession,
  useSessionOutcome,
} from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { leaveForPayment } from '@/lib/navigation';
import { fetchCheckout, initiatePayment, releaseCheckout } from '../api';
import {
  CANT_TAKE_ORDERS,
  paymentProblemFor,
  rateLimitedMessage,
  type PaymentProblem,
} from '../payment-problem';
import { usePaymentStatusPolling } from '../polling';
import type { Checkout, CheckoutPaymentState } from '../schemas';

/**
 * A notice the page shows on top of the backend state, after the customer's own
 * action (Pay on Review, Retry, Review / change order). It never decides the
 * payment's state, which only ever comes from the backend.
 */
export type PaymentNotice =
  | 'gateway_error'
  | 'still_confirming'
  | 'item_unavailable'
  | 'retry_limit'
  | 'configuration'
  | { message: string };

/**
 * `/t/[qrCode]/payment/return` (F-01 S4; technical design §14): where the
 * gateway sends the customer back, and where a payment-stage session resumes.
 *
 * It **never trusts the URL**: the gateway's query parameters are ignored, and
 * the state comes from `GET /customer/checkout`, then from polling
 * `GET /customer/checkout/{id}/status` with backoff (2 s, growing, at most 30 s)
 * while the latest attempt awaits payment. Coming back from the gateway is never
 * shown as paid: S4 never marks a payment Paid (S5 does, with the order).
 *
 * States: confirming; still confirming (an earlier attempt is unresolved);
 * not completed (failed or abandoned: Retry payment, or Review / change order);
 * gateway error; and Review only, when a dish became unavailable or no attempt
 * is left.
 *
 * After a verified payment (S5) the backend reports the outcome: **Order
 * placed**, and the customer goes on to the order page (S6) with the token,
 * items, total and live status; or **paid but not placed** (F1-22): the refund
 * notice, with no order and no token.
 */
export function PaymentReturnPage() {
  const { qrCode, reportSessionEnded, reportSessionWorking, reportSessionStage } =
    useCustomerSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const base = `/t/${encodeURIComponent(qrCode)}`;
  const [notice, setNotice] = useState<PaymentNotice | null>(() => {
    const handed = queryClient.getQueryData<PaymentNotice>(customerKeys.paymentNotice(qrCode));
    queryClient.removeQueries({ queryKey: customerKeys.paymentNotice(qrCode) });
    return handed ?? null;
  });

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

  const current = checkout.data ?? null;
  const paying = current?.status === 'payment_started' ? current : null;
  const latest = paying?.payment?.latestStatus ?? null;
  // A Paid attempt on a checkout still `payment_started` is mid-confirmation.
  const awaiting =
    paying !== null && (latest === null || latest === 'awaiting_payment' || latest === 'paid');

  // Keep the session boundary's stage in step with the backend's outcome (S5), and
  // take a placed order to its order page (S6).
  const outcome = current?.status;
  const placedOrderRef = outcome === 'placed' ? (current?.order?.orderRef ?? null) : null;
  useEffect(() => {
    if (outcome === 'paid_not_placed') reportSessionStage('payment_issue');
  }, [outcome, reportSessionStage]);
  useEffect(() => {
    if (placedOrderRef) router.replace(orderPagePath(qrCode, placedOrderRef));
  }, [placedOrderRef, router, qrCode]);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });

  usePaymentStatusPolling(
    paying?.checkoutId ?? null,
    awaiting,
    (state: CheckoutPaymentState) => {
      reportSessionWorking();
      if (
        state.status !== 'payment_started' ||
        state.payment?.latestStatus !== 'awaiting_payment'
      ) {
        refresh();
      }
    },
    reportSessionEnded,
  );

  const show = (problem: PaymentProblem) => {
    switch (problem.kind) {
      case 'session_ended':
        reportSessionEnded();
        return;
      case 'still_confirming':
        setNotice('still_confirming');
        refresh();
        return;
      case 'gateway_unavailable':
        setNotice('gateway_error');
        refresh();
        return;
      case 'item_unavailable':
        setNotice('item_unavailable');
        return;
      case 'retry_limit':
        setNotice('retry_limit');
        refresh();
        return;
      case 'configuration':
        setNotice('configuration');
        return;
      case 'rate_limited':
        setNotice({ message: rateLimitedMessage(problem.retryAfterSeconds) });
        return;
      case 'error':
        setNotice({ message: problem.message });
        return;
      default:
        // The checkout changed elsewhere (released, superseded): show what it is now.
        setNotice(null);
        refresh();
    }
  };

  const retry = useMutation({
    mutationFn: (checkoutId: string) => initiatePayment(checkoutId),
    onMutate: () => setNotice(null),
    onSuccess: ({ redirectUrl }) => leaveForPayment(redirectUrl),
    onError: (error) => show(paymentProblemFor(error)),
  });

  const release = useMutation({
    mutationFn: (checkoutId: string) => releaseCheckout(checkoutId),
    onSuccess: () => {
      const unavailable = notice === 'item_unavailable';
      setNotice(null);
      reportSessionStage('cart');
      queryClient.removeQueries({ queryKey: customerKeys.checkout(qrCode) });
      void queryClient.invalidateQueries({ queryKey: customerKeys.cart(qrCode) });
      void queryClient.invalidateQueries({ queryKey: customerKeys.menu(qrCode) });
      router.push(unavailable ? `${base}/cart?changed=availability` : `${base}/cart`);
    },
    onError: (error) => show(paymentProblemFor(error)),
  });

  const busy = retry.isPending || release.isPending || retry.isSuccess;

  return (
    <section aria-labelledby="payment-title">
      <h2 id="payment-title" className="mb-4 text-lg font-semibold text-text">
        Payment
      </h2>
      {checkout.isPending || isUnauthorized(checkout.error) || placedOrderRef ? (
        <div aria-busy="true" aria-live="polite">
          <p className="sr-only">Loading your payment…</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : checkout.isError ? (
        <ErrorState
          title="We couldn't load your payment"
          message={userMessageFor(checkout.error)}
          requestId={checkout.error instanceof ApiError ? checkout.error.requestId : undefined}
          action={<Button onClick={() => void checkout.refetch()}>Try again</Button>}
        />
      ) : current?.status === 'paid_not_placed' ? (
        <PaidNotPlaced />
      ) : !paying ? (
        <NoPayment base={base} reviewed={checkout.data !== null} />
      ) : (
        <PaymentState
          checkout={paying}
          awaiting={awaiting}
          notice={notice}
          busy={busy}
          onRetry={() => retry.mutate(paying.checkoutId)}
          onRelease={() => release.mutate(paying.checkoutId)}
        />
      )}
    </section>
  );
}

/** Paid but not placed (F1-22, technical design §14): the refund notice. No order, no token. */
function PaidNotPlaced() {
  return (
    <StatePanel
      role="alert"
      title="Payment received, but your order could not be placed"
      description={
        <p>
          A dish in your order became unavailable before it could be placed. The restaurant will
          handle your refund. Please ask a member of staff if you need help.
        </p>
      }
    />
  );
}

function NoPayment({ base, reviewed }: { base: string; reviewed: boolean }) {
  return (
    <StatePanel
      title="No payment in progress"
      description="Nothing is being paid for this table right now."
      action={
        <Link
          href={reviewed ? `${base}/checkout` : `${base}/cart`}
          className="text-sm font-medium text-brand underline"
        >
          {reviewed ? 'Back to your order' : 'Back to your cart'}
        </Link>
      }
    />
  );
}

type PaymentStateProps = {
  checkout: Checkout;
  awaiting: boolean;
  notice: PaymentNotice | null;
  busy: boolean;
  onRetry: () => void;
  onRelease: () => void;
};

function PaymentState({ checkout, awaiting, notice, busy, onRetry, onRelease }: PaymentStateProps) {
  const payment = checkout.payment;
  const attemptsLeft = payment ? payment.attemptsMade < payment.attemptsLimit : true;
  const total = (
    <p className="mt-2 text-sm text-text-muted">
      Order total <Money amountMinor={checkout.totalMinor} />
    </p>
  );
  const review = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} disabled={busy} onClick={onRelease}>
      Review / change order
    </Button>
  );
  const retry = (label: string, variant: 'primary' | 'secondary' = 'primary') => (
    <Button variant={variant} disabled={busy} onClick={onRetry}>
      {label}
    </Button>
  );
  const actions = (...buttons: ReactNode[]) => (
    <div className="flex flex-wrap justify-center gap-3">{buttons}</div>
  );

  if (notice === 'item_unavailable') {
    return (
      <StatePanel
        role="alert"
        title="A dish in your order is no longer available"
        description={
          <>
            <p>{"This order can't be paid as it is. Review your order to change it."}</p>
            {total}
          </>
        }
        action={review('primary')}
      />
    );
  }
  if (notice === 'configuration') {
    return (
      <StatePanel
        role="alert"
        title="We can't take this payment"
        description={<p>{CANT_TAKE_ORDERS}</p>}
        action={review('secondary')}
      />
    );
  }
  if (awaiting) {
    const still = notice === 'still_confirming';
    return (
      // A key per state: React mounts fresh elements, so no button animates
      // between states (a mid-transition colour once failed axe contrast).
      <div key="confirming" className="space-y-4">
        <StatePanel
          role="status"
          title={still ? 'Still confirming your previous payment…' : 'Confirming payment…'}
          description={
            <>
              <p>
                {still
                  ? 'Your last payment is still being confirmed. You can change your order once it is.'
                  : "We're checking with the payment provider. This page updates by itself."}
              </p>
              {total}
            </>
          }
          action={actions(
            <span key="retry">{retry('Go back to payment', 'secondary')}</span>,
            <span key="review">{review('secondary')}</span>,
          )}
        />
        <NoticeMessage notice={notice} />
      </div>
    );
  }
  if (notice === 'retry_limit' || !attemptsLeft) {
    return (
      <StatePanel
        role="alert"
        title="This order can't be paid again"
        description={
          <>
            <p>Payment was tried the most times allowed. Review your order to start again.</p>
            {total}
          </>
        }
        action={review('primary')}
      />
    );
  }
  const gatewayError = notice === 'gateway_error';
  return (
    <div key={gatewayError ? 'gateway-error' : 'not-completed'} className="space-y-4">
      <StatePanel
        role="alert"
        tone={gatewayError ? 'danger' : 'neutral'}
        title={gatewayError ? "We couldn't start the payment" : 'Payment not completed'}
        description={
          <>
            <p>
              {gatewayError
                ? "We couldn't reach the payment provider. Try again, or review your order."
                : 'Your payment did not go through. You can try again or change your order.'}
            </p>
            {total}
          </>
        }
        action={actions(
          <span key="retry">{retry('Retry payment')}</span>,
          <span key="review">{review('secondary')}</span>,
        )}
      />
      <NoticeMessage notice={notice} />
    </div>
  );
}

function NoticeMessage({ notice }: { notice: PaymentNotice | null }) {
  if (!notice || typeof notice === 'string') return null;
  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-subtle px-4 py-3">
      <p className="text-sm text-text">{notice.message}</p>
    </div>
  );
}
