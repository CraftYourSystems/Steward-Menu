/*
 * The customer realtime connection (F-01 S6; technical design §25, §26).
 *
 * - **Authentication** is the browser's: the HttpOnly session or order-access
 *   cookie goes with the handshake. Nothing in the URL names an order, a table
 *   or a restaurant; the backend fixes the subscription from the cookies.
 * - **Events are hints.** Each one is deduplicated by `event_id` and handed to
 *   `onEvent`, which refetches: the API is the only source of truth.
 * - **Resync** on every (re)connect and whenever the page becomes visible again,
 *   because events published while disconnected are never replayed.
 * - **Reconnect** with exponential backoff (1 s doubling to 30 s, with jitter),
 *   immediately when the page becomes visible or the browser comes back online.
 * - **`4440`** (`customer_access_ended`) means this browser may no longer hear
 *   the order (the session ended at Completed, or the grant expired): no
 *   reconnect. It never leads to a sign-in.
 */

export const CLOSE_ACCESS_ENDED = 4440;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const REMEMBERED_EVENTS = 256;

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'ended';

/** The part of `WebSocket` the connection uses (tests pass a fake). */
export type SocketLike = {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close: (code?: number) => void;
};

export type RealtimeMessage = { event_id: string } & Record<string, unknown>;

export type RealtimeOptions = {
  url: string;
  onEvent: (event: RealtimeMessage) => void;
  onResync: () => void;
  onStatus: (status: RealtimeStatus) => void;
  onAccessEnded: () => void;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
};

export type RealtimeConnection = { close: () => void };

/** `ws(s)://host/ws/customer` for the API base URL `http(s)://host/api/v1`. */
export function customerSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/customer';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Backoff before reconnect attempt `attempt` (0-based): half fixed, half jitter. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

function parse(data: unknown): RealtimeMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { event_id?: unknown }).event_id === 'string'
    ) {
      return value as RealtimeMessage;
    }
  } catch {
    // Not an event: ignored.
  }
  return null;
}

export function connectCustomerRealtime(options: RealtimeOptions): RealtimeConnection {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url) as SocketLike);
  const random = options.random ?? Math.random;
  const seen = new Set<string>();
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const status = (value: RealtimeStatus) => options.onStatus(value);

  function remember(eventId: string): boolean {
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > REMEMBERED_EVENTS) seen.delete(seen.values().next().value as string);
    return true;
  }

  function open() {
    if (stopped) return;
    timer = null;
    status(attempt === 0 ? 'connecting' : 'reconnecting');
    const current = createSocket(options.url);
    socket = current;
    current.onopen = () => {
      if (socket !== current) return;
      attempt = 0;
      status('live');
      options.onResync();
    };
    current.onmessage = ({ data }) => {
      if (socket !== current) return;
      const event = parse(data);
      if (event && remember(event.event_id)) options.onEvent(event);
    };
    current.onerror = () => {
      // A close always follows; reconnecting is decided there.
    };
    current.onclose = ({ code }) => {
      if (socket !== current) return;
      socket = null;
      if (stopped) return;
      if (code === CLOSE_ACCESS_ENDED) {
        stopped = true;
        detach();
        status('ended');
        options.onAccessEnded();
        return;
      }
      status('reconnecting');
      timer = setTimeout(open, reconnectDelay(attempt, random));
      attempt += 1;
    };
  }

  /** Back to the foreground or online: resync now, and reconnect now if waiting. */
  function wake() {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    options.onResync();
    if (timer !== null) {
      clearTimeout(timer);
      open();
    }
  }

  const hasWindow = typeof window !== 'undefined';
  function detach() {
    if (!hasWindow) return;
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
  }
  if (hasWindow) {
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
  }
  open();

  return {
    close() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      detach();
      const current = socket;
      socket = null;
      current?.close(1000);
    },
  };
}
