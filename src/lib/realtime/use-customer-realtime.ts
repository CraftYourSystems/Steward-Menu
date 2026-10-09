'use client';

import { useEffect, useRef, useState } from 'react';
import { getPublicEnv } from '@/lib/env';
import {
  connectCustomerRealtime,
  customerSocketUrl,
  type RealtimeMessage,
  type RealtimeStatus,
  type SocketLike,
} from './connection';

export type CustomerRealtimeStatus = RealtimeStatus | 'off';

type Handlers = {
  /** A deduplicated event this browser may hear (the backend chose what). */
  onEvent: (message: RealtimeMessage) => void;
  /** The connection (re)opened or the page came back: refetch from the API. */
  onResync: () => void;
  /** The server ended this browser's access (`4440`). */
  onAccessEnded?: () => void;
};

/** Test seam: Vitest swaps in a fake socket. */
let socketFactory: ((url: string) => SocketLike) | undefined;
export function setRealtimeSocketFactory(factory: ((url: string) => SocketLike) | undefined) {
  socketFactory = factory;
}

/**
 * One customer WebSocket while `enabled` (F-01 §25, §26): used by the payment
 * return page while a payment is in progress (S7) and by the order page (S6).
 * Events are hints: callers refetch, never apply a status from them.
 */
export function useCustomerRealtime(enabled: boolean, handlers: Handlers): CustomerRealtimeStatus {
  const [status, setStatus] = useState<CustomerRealtimeStatus>('off');
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const connection = connectCustomerRealtime({
      url: customerSocketUrl(getPublicEnv().NEXT_PUBLIC_API_BASE_URL),
      createSocket: socketFactory,
      onStatus: setStatus,
      onResync: () => latest.current.onResync(),
      onAccessEnded: () => latest.current.onAccessEnded?.(),
      onEvent: (message) => latest.current.onEvent(message),
    });
    return () => {
      connection.close();
      setStatus('off');
    };
  }, [enabled]);

  return status;
}
