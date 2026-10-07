'use client';

import { useState } from 'react';
import {
  useCustomerRealtime,
  type CustomerRealtimeStatus,
} from '@/lib/realtime/use-customer-realtime';
import { RealtimeEventSchema, type OrderStatus } from './schemas';

export { setRealtimeSocketFactory } from '@/lib/realtime/use-customer-realtime';

export type OrderRealtime = {
  status: CustomerRealtimeStatus;
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
  const [lastHint, setLastHint] = useState<OrderStatus | null>(null);
  const status = useCustomerRealtime(enabled, {
    onResync: handlers.onChange,
    onAccessEnded: handlers.onAccessEnded,
    onEvent: (message) => {
      const event = RealtimeEventSchema.safeParse(message);
      if (!event.success || event.data.order_id !== orderRef) return;
      if (event.data.order_status) setLastHint(event.data.order_status);
      handlers.onChange();
    },
  });
  return { status, lastHint };
}
