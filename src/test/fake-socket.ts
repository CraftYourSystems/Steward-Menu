import type { SocketLike } from '@/lib/realtime/connection';

/** A WebSocket stand-in the test drives: open it, send it events, close it. */
export class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  closedWith: number | null = null;

  constructor(readonly url: string) {}

  open() {
    this.onopen?.({});
  }

  message(event: unknown) {
    this.receive(JSON.stringify(event));
  }

  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  serverClose(code: number) {
    this.onclose?.({ code });
  }

  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.onclose?.({ code: code ?? 1000 });
  }
}
