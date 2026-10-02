'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { enterSession } from '../api';
import { entryProblemFor } from '../entry-problem';
import { customerKeys } from '../query-keys';
import { CustomerSessionContext, type CustomerSessionValue } from '../session-context';
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
  const retry = () => dispatch({ type: 'retry' });

  const { data } = session;
  const value = useMemo<CustomerSessionValue | null>(
    () =>
      data
        ? {
            qrCode,
            restaurantName: data.restaurantName,
            tableNumber: data.tableNumber,
            reportSessionEnded,
            reportSessionWorking,
          }
        : null,
    [qrCode, data, reportSessionEnded, reportSessionWorking],
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
  if (!data || !value) return <EntryLoading />;
  if (state.phase === 'failed') {
    return <EntryProblemState problem={entryProblemFor(state.error)} onRetry={retry} />;
  }

  return (
    <CustomerSessionContext.Provider value={value}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text">{data.restaurantName}</h1>
        <p className="mt-1 text-sm text-text-muted">Table {data.tableNumber}</p>
      </header>
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
      className="mb-6 rounded-lg border border-border bg-surface-muted px-4 py-3"
    >
      <h2 id="session-ended-title" className="text-sm font-semibold text-text">
        Your session ended
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        There was no activity for a while, so your cart was emptied. You can keep ordering from the
        menu.
      </p>
      <Button variant="secondary" className="mt-3" onClick={onDismiss}>
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
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
