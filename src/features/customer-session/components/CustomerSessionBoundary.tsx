'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { RestaurantHeader } from '@/components/ui/RestaurantHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { orderPagePath } from '@/features/customer-order/paths';
import { enterSession } from '../api';
import { entryProblemFor } from '../entry-problem';
import { customerKeys } from '../query-keys';
import type { EnteredSession } from '../schemas';
import {
  CustomerSessionContext,
  type CustomerSessionStage,
  type CustomerSessionValue,
} from '../session-context';
import { EntryProblemState } from './EntryProblemState';

/**
 * - `working`: normal.
 * - `reentering`: a 401 started a new entry with the same QR code.
 * - `reentered`: entered again; waiting for the first successful request.
 * - `lost`: a request still answered 401 after re-entering (cookies blocked).
 * - `failed`: the new entry itself failed.
 */
type SessionState = {
  phase: 'working' | 'reentering' | 'reentered' | 'lost' | 'failed';
  /** Tell the customer their session (and cart) ended. */
  ended: boolean;
  error: unknown;
};

type SessionAction =
  | { type: 'session_ended' }
  | { type: 'session_working' }
  | { type: 'reentered' }
  | { type: 'reentry_failed'; error: unknown }
  | { type: 'retry' }
  | { type: 'dismiss' };

const INITIAL: SessionState = { phase: 'working', ended: false, error: null };

/** Transitions are atomic, so several 401s at once start exactly one re-entry. */
function reduce(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'session_ended':
      if (state.phase === 'working') return { ...state, phase: 'reentering', ended: true };
      if (state.phase === 'reentered') return { ...state, phase: 'lost' };
      return state;
    case 'session_working':
      return state.phase === 'reentered' ? { ...state, phase: 'working' } : state;
    case 'reentered':
      return { ...state, phase: 'reentered' };
    case 'reentry_failed':
      return { ...state, phase: 'failed', error: action.error };
    case 'retry':
      return { phase: 'reentering', ended: false, error: null };
    case 'dismiss':
      return { ...state, ended: false };
  }
}

/**
 * The customer session of every `/t/[qrCode]` page (F-01 S1, S2): enters or
 * resumes the session for this QR code, shows the restaurant and table, and
 * gives the pages the session context. Everything is fetched in the browser;
 * the session cookie is HttpOnly and never read here.
 *
 * Direct navigation or a reload of any customer page enters again with the
 * page's QR code, which resumes the same session and cart (F1-32).
 *
 * A 401 on any customer request means the session ended (5 minutes without
 * activity, F1-02), and its cart with it. The customer is told so, and the
 * boundary re-enters once with the same QR code, as a rescan would (technical
 * design §6). If the next request still answers 401, the browser is not keeping
 * the session cookie and the customer is told to allow cookies. It never
 * redirects to a sign-in page.
 *
 * A session in the `payment` stage (S4) or `payment_issue` (S5) belongs on the
 * payment return page: every other customer page sends it there, because its
 * cart is locked (technical design §1, §14). A `placed` session belongs on its
 * order page (S6), so a same-table rescan resumes the order (F1-32); once the
 * order is Completed the session has ended and a rescan starts afresh (F1-37).
 */
export function CustomerSessionBoundary({
  qrCode,
  children,
}: {
  qrCode: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: customerKeys.session(qrCode),
    queryFn: ({ signal }) => enterSession(qrCode, { signal }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const { refetch: refetchSession } = session;
  const router = useRouter();
  const pathname = usePathname();
  const returnPath = `/t/${encodeURIComponent(qrCode)}/payment/return`;
  const onReturnPage = pathname.endsWith('/payment/return');
  const stage = session.data?.stage;
  const orderRef = session.data?.orderRef ?? null;
  const redirectTo =
    stage === 'placed' && orderRef
      ? orderPagePath(qrCode, orderRef)
      : stage !== undefined && stage !== 'cart' && !onReturnPage
        ? returnPath
        : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  useEffect(() => {
    if (state.phase !== 'reentering') return;
    let current = true;
    void refetchSession().then((result) => {
      if (!current) return;
      if (!result.isSuccess) {
        dispatch({ type: 'reentry_failed', error: result.error });
        return;
      }
      dispatch({ type: 'reentered' });
      void queryClient.invalidateQueries({ queryKey: customerKeys.menu(qrCode) });
      void queryClient.invalidateQueries({ queryKey: customerKeys.cart(qrCode) });
    });
    return () => {
      current = false;
    };
  }, [state.phase, refetchSession, queryClient, qrCode]);

  const reportSessionEnded = useCallback(() => dispatch({ type: 'session_ended' }), []);
  const reportSessionWorking = useCallback(() => dispatch({ type: 'session_working' }), []);
  const reportSessionStage = useCallback(
    (stage: CustomerSessionStage) =>
      queryClient.setQueryData<EnteredSession>(customerKeys.session(qrCode), (current) =>
        current ? { ...current, stage } : current,
      ),
    [queryClient, qrCode],
  );
  const retry = () => dispatch({ type: 'retry' });

  const { data } = session;
  const value = useMemo<CustomerSessionValue | null>(
    () =>
      data
        ? {
            qrCode,
            restaurantName: data.restaurantName,
            tableNumber: data.tableNumber,
            stage: data.stage,
            reportSessionStage,
            reportSessionEnded,
            reportSessionWorking,
          }
        : null,
    [qrCode, data, reportSessionStage, reportSessionEnded, reportSessionWorking],
  );

  if (session.isPending) return <EntryLoading />;
  if (session.isError && !data) {
    return (
      <EntryProblemState
        problem={entryProblemFor(session.error)}
        onRetry={() => void refetchSession()}
      />
    );
  }
  if (!data || !value || redirectTo) return <EntryLoading />;
  if (state.phase === 'failed') {
    return <EntryProblemState problem={entryProblemFor(state.error)} onRetry={retry} />;
  }

  return (
    <CustomerSessionContext.Provider value={value}>
      <RestaurantHeader
        eyebrow="Welcome to"
        restaurantName={data.restaurantName}
        tableNumber={data.tableNumber}
      />
      {state.phase === 'lost' ? (
        <ErrorState
          title="We couldn't keep your table session"
          message="Make sure cookies are allowed for this site, then try again."
          action={<Button onClick={retry}>Try again</Button>}
        />
      ) : (
        <>
          {state.ended ? (
            <SessionEndedNotice onDismiss={() => dispatch({ type: 'dismiss' })} />
          ) : null}
          {children}
        </>
      )}
    </CustomerSessionContext.Provider>
  );
}

function SessionEndedNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section
      role="status"
      aria-labelledby="session-ended-title"
      className="mb-6 rounded-3xl border border-brand-border bg-brand-surface px-5 py-4"
    >
      <h2 id="session-ended-title" className="text-sm font-bold text-text">
        Your session ended
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        There was no activity for a while, so your cart was emptied. You can keep ordering from the
        menu.
      </p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onDismiss}>
        OK
      </Button>
    </section>
  );
}

function EntryLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Opening the menu…</p>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/4" />
      <div className="mt-8 space-y-4">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
