'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageTitleBar } from '@/components/ui/PageTitleBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { StickyFooter } from '@/components/ui/StickyFooter';
import { customerKeys } from '@/features/customer-session/query-keys';
import {
  isUnauthorized,
  useCustomerSession,
  useSessionOutcome,
} from '@/features/customer-session/session-context';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { fetchDetails, saveDetails } from '../api';
import { isCartLocked, isOrderAlreadyPlaced } from '@/features/customer-checkout/payment-problem';
import { detailsProblemFor, type DetailsProblem } from '../details-problem';
import { nationalNumber, type CustomerDetails } from '../schemas';

/**
 * `/t/[qrCode]/details` (route map; F-01 S3): Name + Indian mobile number,
 * stored on the session by the backend, which validates and normalizes them.
 * No OTP and no verification (F1-17). A reload shows what was saved. Saving
 * supersedes any open review, then continues to the review step.
 */
export function CustomerDetailsPage() {
  const { qrCode } = useCustomerSession();
  const details = useQuery({
    queryKey: customerKeys.details(qrCode),
    queryFn: ({ signal }) => fetchDetails({ signal }),
    retry: (failureCount, error) =>
      !isUnauthorized(error) &&
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
  });
  useSessionOutcome(details);

  return (
    <section aria-labelledby="details-title">
      <PageTitleBar
        id="details-title"
        title="Your details"
        back={{ href: `/t/${encodeURIComponent(qrCode)}/cart`, label: 'Back to cart' }}
      />
      {details.isPending || isUnauthorized(details.error) ? (
        <div aria-busy="true" aria-live="polite">
          <p className="sr-only">Loading your details…</p>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="mt-4 h-12 w-full" />
        </div>
      ) : details.isError ? (
        <ErrorState
          title="We couldn't load your details"
          message={userMessageFor(details.error)}
          requestId={details.error instanceof ApiError ? details.error.requestId : undefined}
          action={<Button onClick={() => void details.refetch()}>Try again</Button>}
        />
      ) : (
        <DetailsForm saved={details.data} />
      )}
    </section>
  );
}

function DetailsForm({ saved }: { saved: CustomerDetails }) {
  const { qrCode, reportSessionEnded, reportSessionWorking, reportSessionStage } =
    useCustomerSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(saved.name ?? '');
  const [mobile, setMobile] = useState(nationalNumber(saved.mobile));
  const [problem, setProblem] = useState<DetailsProblem | null>(null);

  const save = useMutation({
    mutationFn: () => saveDetails(name, mobile),
    onMutate: () => setProblem(null),
    onSuccess: (result) => {
      queryClient.setQueryData(customerKeys.details(qrCode), result);
      // Saving supersedes the open review on the server (S3).
      void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });
      reportSessionWorking();
      router.push(`/t/${encodeURIComponent(qrCode)}/checkout`);
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        reportSessionEnded();
        return;
      }
      if (isCartLocked(error)) {
        // Payment is in progress (S4): the session boundary takes the customer there.
        reportSessionStage('payment');
        return;
      }
      if (isOrderAlreadyPlaced(error)) {
        // The order was placed (S5): the boundary takes the customer to its confirmation.
        reportSessionStage('placed');
        return;
      }
      setProblem(detailsProblemFor(error));
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const fieldError = (field: 'name' | 'mobile') =>
    problem?.kind === 'fields' ? problem.fields[field] : undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {problem?.kind === 'rate_limited' ? (
        <p
          role="alert"
          className="rounded-2xl border border-danger bg-danger-subtle px-4 py-3 text-sm"
        >
          {problem.retryAfterSeconds
            ? `Too many attempts. Please wait ${problem.retryAfterSeconds} seconds and try again.`
            : 'Too many attempts. Please wait a moment and try again.'}
        </p>
      ) : null}
      {problem?.kind === 'error' ? (
        <div
          role="alert"
          className="rounded-2xl border border-danger bg-danger-subtle px-4 py-3 text-sm"
        >
          <p>{problem.message}</p>
          {problem.requestId ? (
            <p className="mt-1 font-mono text-xs text-text-muted">Reference: {problem.requestId}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-5 rounded-3xl bg-surface p-5 shadow-sm">
        <Field
          id="customer-name"
          label="Name"
          value={name}
          onChange={setName}
          error={fieldError('name')}
          autoComplete="name"
          hint={undefined}
        />
        <Field
          id="customer-mobile"
          label="Mobile number"
          value={mobile}
          onChange={setMobile}
          error={fieldError('mobile')}
          autoComplete="tel-national"
          inputMode="tel"
          hint="A 10-digit Indian mobile number, for example 98765 43210. No verification code is needed."
        />
      </div>

      <StickyFooter>
        <Button type="submit" disabled={save.isPending} className="w-full">
          {save.isPending ? 'Saving…' : 'Continue to review'}
        </Button>
      </StickyFooter>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  hint: string | undefined;
  autoComplete: string;
  inputMode?: 'tel';
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-text">
        {label}
      </label>
      <input
        id={id}
        type={inputMode === 'tel' ? 'tel' : 'text'}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-12 w-full rounded-xl border-[1.5px] bg-surface px-4 text-base text-text focus:border-brand focus:shadow-ring-brand ${error ? 'border-danger' : 'border-border-strong'}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
