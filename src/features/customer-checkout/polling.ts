'use client';

import { useEffect, useRef } from 'react';
import { isUnauthorized } from '@/features/customer-session/session-context';
import { fetchCheckoutStatus } from './api';
import type { CheckoutPaymentState } from './schemas';

/*
 * The payment return page's status polling (F-01 technical design §14, TD-23):
 * 2 seconds at first, growing by half each time, at most 30 seconds. It runs only
 * after payment was initiated, when the 5-minute cart rule no longer applies
 * (F1-05), and the backend does not count it as customer activity (F1-04).
 */
export const POLL_INITIAL_MS = 2_000;
export const POLL_FACTOR = 1.5;
export const POLL_MAX_MS = 30_000;

/** The wait before poll number `index` (0-based). */
export function pollDelay(index: number): number {
  return Math.min(POLL_MAX_MS, Math.round(POLL_INITIAL_MS * POLL_FACTOR ** index));
}

/**
 * Polls `GET /customer/checkout/{id}/status` with backoff while `active`. Each
 * answer goes to `onState`; a 401 goes to `onSessionEnded` and stops polling.
 * Other failures (network, 429, 5xx) only wait for the next, longer delay.
 */
export function usePaymentStatusPolling(
  checkoutId: string | null,
  active: boolean,
  onState: (state: CheckoutPaymentState) => void,
  onSessionEnded: () => void,
) {
  const handlers = useRef({ onState, onSessionEnded });
  useEffect(() => {
    handlers.current = { onState, onSessionEnded };
  });

  useEffect(() => {
    if (!checkoutId || !active) return;
    const controller = new AbortController();
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(() => void poll(), pollDelay(index));
      index += 1;
    };
    const poll = async () => {
      try {
        const state = await fetchCheckoutStatus(checkoutId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        handlers.current.onState(state);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorized(error)) {
          handlers.current.onSessionEnded();
          return;
        }
      }
      schedule();
    };

    schedule();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [checkoutId, active]);
}
