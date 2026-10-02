'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchCustomerMenu } from '@/features/customer-menu/api';
import { CustomerMenuView } from '@/features/customer-menu/components/CustomerMenuView';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { enterSession } from '../api';
import { entryProblemFor } from '../entry-problem';
import { customerKeys } from '../query-keys';
import { EntryProblemState } from './EntryProblemState';

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'unauthorized';
}

/**
 * The customer QR entry flow (F-01 S1): enter or resume the customer session
 * for this QR code, then load the session restaurant's menu. Everything is
 * fetched in the browser; the session cookie is HttpOnly and never read here.
 *
 * A 401 on the menu means the session ended (5 minutes without activity,
 * F1-02). The page then re-enters with the same QR code once, exactly as a
 * rescan would; if the menu still answers 401, the browser is not keeping the
 * session cookie and the customer is told so. It never redirects to `/login`.
 */
export function CustomerEntry({ qrCode }: { qrCode: string }) {
  const session = useQuery({
    queryKey: customerKeys.session(qrCode),
    queryFn: ({ signal }) => enterSession(qrCode, { signal }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const menu = useQuery({
    queryKey: customerKeys.menu(qrCode),
    queryFn: ({ signal }) => fetchCustomerMenu({ signal }),
    enabled: session.isSuccess,
    retry: (failureCount, error) =>
      !isUnauthorized(error) &&
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
  });

  const reentered = useRef(false);
  const [sessionLost, setSessionLost] = useState(false);
  const { refetch: refetchSession } = session;
  const { refetch: refetchMenu } = menu;

  useEffect(() => {
    if (menu.isSuccess) reentered.current = false;
  }, [menu.isSuccess, menu.dataUpdatedAt]);

  useEffect(() => {
    if (!isUnauthorized(menu.error)) return;
    if (reentered.current) {
      setSessionLost(true);
      return;
    }
    reentered.current = true;
    void refetchSession().then((result) => {
      if (result.isSuccess) void refetchMenu();
    });
  }, [menu.error, menu.errorUpdatedAt, refetchSession, refetchMenu]);

  if (session.isPending) return <EntryLoading />;
  if (session.isError) {
    return (
      <EntryProblemState
        problem={entryProblemFor(session.error)}
        onRetry={() => void refetchSession()}
      />
    );
  }

  const retryAll = () => {
    setSessionLost(false);
    reentered.current = false;
    void refetchSession().then((result) => {
      if (result.isSuccess) void refetchMenu();
    });
  };

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text">{session.data.restaurantName}</h1>
        <p className="mt-1 text-sm text-text-muted">Table {session.data.tableNumber}</p>
      </header>
      {sessionLost ? (
        <ErrorState
          title="We couldn't keep your table session"
          message="Make sure cookies are allowed for this site, then try again."
          action={<Button onClick={retryAll}>Try again</Button>}
        />
      ) : menu.isPending || isUnauthorized(menu.error) ? (
        <MenuLoading />
      ) : menu.isError ? (
        <ErrorState
          title="We couldn't load the menu"
          message={userMessageFor(menu.error)}
          requestId={menu.error instanceof ApiError ? menu.error.requestId : undefined}
          action={<Button onClick={() => void refetchMenu()}>Try again</Button>}
        />
      ) : (
        <CustomerMenuView menu={menu.data} />
      )}
    </>
  );
}

function EntryLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Opening the menu…</p>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/4" />
      <MenuSkeleton />
    </div>
  );
}

function MenuLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading the menu…</p>
      <MenuSkeleton />
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="mt-8 space-y-4">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-12 w-full" />
      ))}
    </div>
  );
}
