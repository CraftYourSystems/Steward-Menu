'use client';

import { useEffect, useRef, useState } from 'react';
import { getPublicEnv } from '@/lib/env';
import {
  connectCustomerRealtime,
  customerSocketUrl,
  type RealtimeStatus,
  type SocketLike,
} from '@/lib/realtime/connection';
import { RealtimeEventSchema, type OrderStatus } from './schemas';

export type OrderRealtime = {
  status: RealtimeStatus | 'off';
  /**
   * The last status hint for this order from an event. Never shown on its own:
   * only once the server has ended this browser's access (`4440`) and the API
   * can no longer be asked (§26).
   */
  lastHint: OrderStatus | null;
};

type Handlers = {
  /** Refetch the order: an event arrived, or the connection (re)opened. */
  onChange: () => void;
  /** The server ended this browser's access to the order (`4440`). */
  onAccessEnded: () => void;
};

/** Test seam: Vitest swaps in a fake socket. */
let socketFactory: ((url: string) => SocketLike) | undefined;
export function setRealtimeSocketFactory(factory: ((url: string) => SocketLike) | undefined) {
  socketFactory = factory;
}

/**
 * Live status for one order page (F-01 S6; technical design §25, §26). While
 * `enabled`, it keeps a customer WebSocket open; every event for this order and
 * every (re)connect triggers `onChange`, which refetches from the API.
 */
export function useOrderRealtime(
  orderRef: string,
  enabled: boolean,
  handlers: Handlers,
): OrderRealtime {
  const [status, setStatus] = useState<RealtimeStatus | 'off'>('off');
  const [lastHint, setLastHint] = useState<OrderStatus | null>(null);
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
      onResync: () => latest.current.onChange(),
      onAccessEnded: () => latest.current.onAccessEnded(),
      onEvent: (message) => {
        const event = RealtimeEventSchema.safeParse(message);
        if (!event.success || event.data.order_id !== orderRef) return;
        if (event.data.order_status) setLastHint(event.data.order_status);
        latest.current.onChange();
      },
    });
    return () => {
      connection.close();
      setStatus('off');
    };
  }, [enabled, orderRef]);

  return { status, lastHint };
}
