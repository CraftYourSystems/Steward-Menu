'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Money } from '@/components/ui/Money';
import { RestaurantHeader } from '@/components/ui/RestaurantHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatePanel } from '@/components/ui/StatePanel';
import { customerKeys } from '@/features/customer-session/query-keys';
import { ApiError, userMessageFor } from '@/lib/api/errors';
import { fetchCustomerOrder, redeemOrderAccess } from '../api';
import { ORDER_STATUSES, type CustomerOrder, type OrderStatus } from '../schemas';
import { newerOrder, STATUS_COPY, statusRank } from '../status';
import { useOrderRealtime, type OrderRealtime } from '../use-order-realtime';

/** While the socket is down, the page still refreshes itself this often. */
const FALLBACK_REFRESH_MS = 30_000;

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

function time(iso: string | number): string {
  return TIME.format(new Date(iso));
}

/**
 * Reads the SMS link's secret from the URL fragment (`#k=…`) once, and removes
 * it from the address bar and history straight away, so it is never bookmarked,
 * shared or kept. Fragments never reach a server or a `Referer`.
 */
function takeLinkSecret(): string | null {
  const match = /^#k=([A-Za-z0-9_-]{1,64})$/.exec(window.location.hash);
  if (window.location.hash) {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }
  return match ? match[1]! : null;
}

type Access =
  | { phase: 'starting' }
  | { phase: 'redeeming'; secret: string }
  | { phase: 'ready' }
  /** The link was not accepted: unknown, wrong or expired (one generic answer). */
  | { phase: 'link_invalid' }
  | { phase: 'redeem_failed'; secret: string; error: unknown };

/**
 * `/t/[qrCode]/orders/[orderRef]` (F-01 S6; technical design §23 to §26): the
 * customer's order with its token, items, amounts and live status.
 *
 * **Access** is the backend's: the session that placed the order (until it is
 * Completed), or a grant this browser gets by redeeming an SMS link's secret.
 * The order reference in the URL grants nothing by itself, and every refusal
 * looks the same, so the page never says which part did not match.
 *
 * It sits **outside** the table session boundary: opening an SMS link on
 * another device never enters a table session.
 *
 * **Live status:** the API is the source of truth. Realtime events, every
 * (re)connect and the page becoming visible trigger a refetch; a status never
 * moves backwards on screen. When the server ends this browser's access at
 * Completed (`4440`), the last order shown stays, marked Completed.
 */
export function CustomerOrderPage({ orderRef }: { qrCode: string; orderRef: string }) {
  const queryClient = useQueryClient();
  const [access, setAccess] = useState<Access>({ phase: 'starting' });
  const [accessEnded, setAccessEnded] = useState(false);

  useEffect(() => {
    const secret = takeLinkSecret();
    // Reading the fragment needs the browser, so it happens after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccess(secret ? { phase: 'redeeming', secret } : { phase: 'ready' });
    // A link opened in a tab already on this page only changes the fragment: no
    // remount, so the new secret is taken (and removed) here.
    const onHashChange = () => {
      const next = takeLinkSecret();
      if (next) setAccess({ phase: 'redeeming', secret: next });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const redeem = useMutation({
    mutationFn: (secret: string) => redeemOrderAccess(orderRef, secret),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: customerKeys.order(orderRef) });
      setAccess({ phase: 'ready' });
    },
    onError: (error, secret) =>
      setAccess(
        error instanceof ApiError && error.kind === 'not_found'
          ? { phase: 'link_invalid' }
          : { phase: 'redeem_failed', secret, error },
      ),
  });
  const { mutate: redeemSecret } = redeem;
  const redeemingSecret = access.phase === 'redeeming' ? access.secret : null;
  useEffect(() => {
    if (redeemingSecret) redeemSecret(redeemingSecret);
  }, [redeemingSecret, redeemSecret]);

  const order = useQuery({
    queryKey: customerKeys.order(orderRef),
    queryFn: ({ signal }) => fetchCustomerOrder(orderRef, { signal }),
    enabled: access.phase === 'ready',
    retry: (failureCount, error) =>
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
    // Out-of-order responses never move the status backwards.
    structuralSharing: (shown, incoming) =>
      newerOrder(shown as CustomerOrder | undefined, incoming as CustomerOrder),
  });

  const data = order.data;
  const live = access.phase === 'ready' && !!data && data.status !== 'completed' && !accessEnded;
  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: customerKeys.order(orderRef) }),
    [queryClient, orderRef],
  );
  const realtime = useOrderRealtime(orderRef, live, {
    onChange: refresh,
    onAccessEnded: () => {
      setAccessEnded(true);
      refresh();
    },
  });

  // Without a live connection, keep refreshing slowly as a fallback.
  const { refetch } = order;
  const fallback = live && realtime.status !== 'live';
  useEffect(() => {
    if (!fallback) return;
    const timer = setInterval(() => void refetch(), FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fallback, refetch]);

  if (access.phase === 'link_invalid') return <OrderUnavailable />;
  if (access.phase === 'redeem_failed') {
    return (
      <ErrorState
        title="We couldn't open your order"
        message={userMessageFor(access.error)}
        requestId={access.error instanceof ApiError ? access.error.requestId : undefined}
        action={<Button onClick={() => redeem.mutate(access.secret)}>Try again</Button>}
      />
    );
  }
  if (access.phase !== 'ready' || order.isPending) return <OrderLoading />;

  if (order.isError && !data) {
    if (order.error instanceof ApiError && order.error.kind === 'not_found') {
      return <OrderUnavailable />;
    }
    return (
      <ErrorState
        title="We couldn't load your order"
        message={userMessageFor(order.error)}
        requestId={order.error instanceof ApiError ? order.error.requestId : undefined}
        action={<Button onClick={() => void order.refetch()}>Try again</Button>}
      />
    );
  }

  // The server ended this browser's access (`4440`) after a Completed event: the
  // API can no longer be asked, so the last order shown stays, marked Completed.
  const final =
    accessEnded && realtime.lastHint === 'completed' && data && data.status !== 'completed';
  const shown: CustomerOrder = final ? { ...data, status: 'completed' } : data!;
  return (
    <OrderView
      order={shown}
      asOf={order.dataUpdatedAt}
      realtime={realtime}
      accessEnded={accessEnded || shown.status === 'completed'}
    />
  );
}

function OrderView({
  order,
  asOf,
  realtime,
  accessEnded,
}: {
  order: CustomerOrder;
  asOf: number;
  realtime: OrderRealtime;
  accessEnded: boolean;
}) {
  const copy = STATUS_COPY[order.status];
  const reached = new Map(order.history.map((entry) => [entry.state, entry.occurredAt]));
  return (
    <article aria-labelledby="order-title" className="space-y-4">
      <RestaurantHeader restaurantName={order.restaurantName} tableNumber={order.tableNumber} />

      {/* The prototype's order header card. */}
      <section className="rounded-3xl bg-brand bg-gradient-card p-6 text-text-inverse shadow-brand">
        <h2 id="order-title" className="text-xs font-semibold tracking-[0.04em] uppercase">
          Your order
        </h2>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm">Your token</p>
            <p
              className="mt-1 font-display text-5xl leading-none font-bold tabular-nums"
              aria-label={`Token ${order.tokenNumber}`}
            >
              {order.tokenNumber}
            </p>
          </div>
          <p className="text-sm">
            Placed at <time dateTime={order.placedAt}>{time(order.placedAt)}</time>
          </p>
        </div>
      </section>

      <section aria-labelledby="status-title" className="rounded-3xl bg-surface p-6 shadow-sm">
        <h2 id="status-title" className="text-base font-bold tracking-tight text-text">
          Order status
        </h2>
        <div role="status" aria-label="Current status" className="mt-2">
          <p className="text-xl font-bold tracking-tight text-text">{copy.label}</p>
          <p className="text-sm text-text-muted">{copy.description}</p>
        </div>
        <ol className="mt-6" aria-label="Progress">
          {ORDER_STATUSES.map((state) => (
            <Step
              key={state}
              state={state}
              current={order.status}
              at={reached.get(state) ?? null}
            />
          ))}
        </ol>
        <LiveIndicator realtime={realtime} asOf={asOf} accessEnded={accessEnded} />
      </section>

      <section aria-labelledby="items-title" className="rounded-3xl bg-surface p-5 shadow-sm">
        <h2 id="items-title" className="text-base font-bold tracking-tight text-text">
          Items
        </h2>
        <ul className="mt-2 divide-y divide-border">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium break-words text-text">
                  <span className="font-bold text-brand">{item.quantity} ×</span> {item.name}
                </p>
                {item.specialInstructions ? (
                  <p className="mt-0.5 text-xs break-words text-text-muted italic">
                    Note: {item.specialInstructions}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 font-semibold text-text">
                <Money amountMinor={item.lineTotalMinor} />
              </p>
            </li>
          ))}
        </ul>

        <section
          aria-labelledby="amounts-title"
          className="mt-2 border-t border-dashed border-border-strong pt-4"
        >
          <h2 id="amounts-title" className="sr-only">
            Amounts
          </h2>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between text-text-muted">
              <dt>Subtotal</dt>
              <dd>
                <Money amountMinor={order.subtotalMinor} />
              </dd>
            </div>
            {order.taxes.map((tax, index) => (
              <div key={index} className="flex justify-between text-text-muted">
                <dt>{tax.label}</dt>
                <dd>
                  <Money amountMinor={tax.amountMinor} />
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-text">
              <dt>Total paid</dt>
              <dd>
                <Money amountMinor={order.totalMinor} />
              </dd>
            </div>
          </dl>
        </section>
      </section>
    </article>
  );
}

function Step({
  state,
  current,
  at,
}: {
  state: OrderStatus;
  current: OrderStatus;
  at: string | null;
}) {
  const done = statusRank(state) <= statusRank(current);
  const isCurrent = state === current;
  const isLast = statusRank(state) === ORDER_STATUSES.length - 1;
  // The prototype's timeline: ✓ for reached steps, a pulsing dot for the one in
  // progress, a line down to the next step.
  const inProgress = isCurrent && !isLast;
  return (
    <li
      aria-current={isCurrent ? 'step' : undefined}
      className="relative flex items-start justify-between gap-3 pb-6 text-sm last:pb-0"
    >
      {isLast ? null : (
        <span
          aria-hidden="true"
          className={`absolute top-7 bottom-0 left-[11px] w-0.5 ${
            done && !isCurrent ? 'bg-brand' : 'bg-border'
          }`}
        />
      )}
      <span className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={`relative flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold text-brand-contrast ${
            done ? 'bg-brand' : 'bg-border'
          }`}
        >
          {inProgress ? (
            <span className="size-2.5 rounded-full bg-surface motion-safe:animate-step-pulse" />
          ) : done ? (
            '✓'
          ) : null}
        </span>
        <span className={done ? 'font-semibold text-text' : 'text-text-muted'}>
          {STATUS_COPY[state].label}
          <span className="sr-only">{done ? ' (done)' : ' (not yet)'}</span>
        </span>
      </span>
      {done && at ? (
        <time dateTime={at} className="pt-0.5 text-xs text-text-muted">
          {time(at)}
        </time>
      ) : null}
    </li>
  );
}

function LiveIndicator({
  realtime,
  asOf,
  accessEnded,
}: {
  realtime: OrderRealtime;
  asOf: number;
  accessEnded: boolean;
}) {
  const label = accessEnded
    ? null
    : realtime.status === 'live'
      ? 'Live updates on'
      : realtime.status === 'off'
        ? null
        : 'Reconnecting…';
  return (
    <p className="mt-6 flex flex-wrap justify-between gap-2 border-t border-border pt-4 text-xs text-text-muted">
      {label ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${realtime.status === 'live' ? 'bg-brand motion-safe:animate-step-pulse' : 'bg-border-strong'}`}
          />
          {label}
        </span>
      ) : (
        <span />
      )}
      {asOf ? <span>Status as of {time(asOf)}</span> : null}
    </p>
  );
}

/** One answer for an unknown, wrong or expired link, or access that has ended. */
function OrderUnavailable() {
  return (
    <StatePanel
      role="alert"
      headingLevel="h1"
      title="This order link isn't available"
      description={
        <p>
          The link may have expired or be incomplete. Use the latest link from your SMS, or ask a
          member of staff for help.
        </p>
      }
    />
  );
}

function OrderLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading your order…</p>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-6 h-36 w-full rounded-3xl" />
      <Skeleton className="mt-4 h-56 w-full rounded-3xl" />
    </div>
  );
}
