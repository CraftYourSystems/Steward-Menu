import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '@/test/fake-socket';
import {
  CLOSE_ACCESS_ENDED,
  connectCustomerRealtime,
  customerSocketUrl,
  reconnectDelay,
  type RealtimeConnection,
  type RealtimeStatus,
} from './connection';

/*
 * The customer realtime connection (F-01 S6; technical design §25, §26):
 * events are deduplicated hints, every (re)connect and return to the page
 * resyncs, reconnects back off with jitter, and 4440 ends it for good.
 */

let sockets: FakeSocket[];
let statuses: RealtimeStatus[];
let connections: RealtimeConnection[];
const onEvent = vi.fn();
const onResync = vi.fn();
const onAccessEnded = vi.fn();

function connect() {
  const connection = connectCustomerRealtime({
    url: 'ws://api.test/ws/customer',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
    onEvent,
    onResync,
    onAccessEnded,
    onStatus: (status) => statuses.push(status),
  });
  connections.push(connection);
  return connection;
}

function latest(): FakeSocket {
  return sockets.at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  statuses = [];
  connections = [];
});

afterEach(() => {
  connections.forEach((connection) => connection.close());
  vi.useRealTimers();
  onEvent.mockReset();
  onResync.mockReset();
  onAccessEnded.mockReset();
});

describe('customerSocketUrl', () => {
  it('is the API host with ws(s) and /ws/customer, and nothing that names an order', () => {
    expect(customerSocketUrl('http://localhost:8000/api/v1')).toBe(
      'ws://localhost:8000/ws/customer',
    );
    expect(customerSocketUrl('https://api.example.com/api/v1?x=1')).toBe(
      'wss://api.example.com/ws/customer',
    );
  });
});

describe('reconnectDelay', () => {
  it('doubles from 1 s to a 30 s ceiling, half of it jitter', () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 1)).toBe(1_000);
    expect(reconnectDelay(3, () => 1)).toBe(8_000);
    expect(reconnectDelay(10, () => 0)).toBe(15_000);
    expect(reconnectDelay(10, () => 1)).toBe(30_000);
  });
});

describe('connectCustomerRealtime', () => {
  it('resyncs on open and hands over each event once, deduplicated by event_id', () => {
    connect();
    expect(statuses).toEqual(['connecting']);
    latest().open();
    expect(statuses.at(-1)).toBe('live');
    expect(onResync).toHaveBeenCalledTimes(1);

    const event = { event_id: 'e1', type: 'order.status_changed', order_id: 'o1' };
    latest().message(event);
    latest().message(event); // at-least-once delivery: a duplicate
    latest().message({ event_id: 'e2', type: 'order.status_changed', order_id: 'o1' });
    latest().receive('not json');
    latest().message({ type: 'no id' });
    expect(onEvent.mock.calls.map(([e]) => e.event_id)).toEqual(['e1', 'e2']);
  });

  it('reconnects with backoff and resyncs after every reconnect', () => {
    connect();
    latest().open();
    latest().serverClose(1006);
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(749);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1); // 0.5 s fixed + 0.25 s jitter
    expect(sockets).toHaveLength(2);
    latest().serverClose(1006); // never opened: the next wait doubles
    vi.advanceTimersByTime(1_499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    latest().open();
    expect(statuses.at(-1)).toBe('live');
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it('4440 ends the connection: no reconnect, and the page is told', () => {
    connect();
    latest().open();
    latest().serverClose(CLOSE_ACCESS_ENDED);
    expect(statuses.at(-1)).toBe('ended');
    expect(onAccessEnded).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('returning to the page resyncs and reconnects at once', () => {
    connect();
    latest().open();
    latest().serverClose(1006);
    onResync.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
    window.dispatchEvent(new Event('online')); // already connecting: just a resync
    expect(sockets).toHaveLength(2);
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it('close() stops everything, including a pending reconnect', () => {
    const connection = connect();
    latest().open();
    latest().serverClose(1006);
    connection.close();
    vi.advanceTimersByTime(60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sockets).toHaveLength(1);
    const live = connect();
    latest().open();
    live.close();
    expect(latest().closedWith).toBe(1000);
    latest().message({ event_id: 'late', type: 'order.status_changed' });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
