/**
 * Standalone mock of the FastAPI customer endpoints for local development and
 * Playwright. Serves the MSW handlers over HTTP so the browser hits the same
 * mocks as Vitest. Never part of the application bundle.
 *
 *   pnpm mock:api                   # http://localhost:8788
 *   MOCK_API_PORT=9000 pnpm mock:api
 *
 * The default port differs from Steward-Frontend's mock API (8787) so both
 * can run side by side.
 *
 * It also serves the customer WebSocket `/ws/customer` (F-01 S6) like FastAPI:
 * the handshake needs an `Origin`; the subscription comes from the cookies
 * only (the session's order, the grant's order); events are identifiers and a
 * status hint; a session's socket closes with `4440` after its order completes,
 * and one with no order access closes with `4440` straight away.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getResponse } from 'msw';
import { WebSocketServer } from 'ws';
import { handlers } from '../msw/handlers';
import { mockSocketAccess, onMockOrderEvent } from '../msw/handlers/customer';

const port = Number(process.env.MOCK_API_PORT ?? 8788);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  return new Request(new URL(req.url ?? '/', `http://localhost:${port}`), {
    method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
  });
}

/** Mirrors the backend's CORS: exact origin echo with credentials. */
function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After');
  res.setHeader('Vary', 'Origin');
}

const server = createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.writeHead(204).end();
    return;
  }

  const response =
    (await getResponse(handlers, await toFetchRequest(req))) ??
    Response.json(
      { error: { code: 'not_found', message: `No mock for ${req.method} ${req.url}` } },
      { status: 404 },
    );

  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.writeHead(response.status);
  res.end(Buffer.from(await response.arrayBuffer()));
});

const CLOSE_ACCESS_ENDED = 4440;
const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;
  if (path !== '/ws/customer' || !req.headers.origin) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const access = mockSocketAccess(req.headers.cookie);
    const scopes = new Set([access.sessionOrderId, access.grantOrderId].filter(Boolean));
    if (scopes.size === 0) {
      ws.close(CLOSE_ACCESS_ENDED, 'customer_access_ended');
      return;
    }
    const stop = onMockOrderEvent((event) => {
      if (!scopes.has(event.order_id)) return;
      ws.send(JSON.stringify(event));
      const sessionEnded =
        event.order_status === 'completed' &&
        event.order_id === access.sessionOrderId &&
        access.grantOrderId === null;
      if (sessionEnded) {
        stop();
        ws.close(CLOSE_ACCESS_ENDED, 'customer_access_ended');
      }
    });
    ws.on('close', stop);
    ws.on('message', () => {
      // Client messages never choose anything: ignored.
    });
  });
});

server.listen(port, () => {
  console.log(`[mock-api] listening on http://localhost:${port}`);
});
