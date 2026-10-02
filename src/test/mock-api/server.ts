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
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getResponse } from 'msw';
import { handlers } from '../msw/handlers';

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

server.listen(port, () => {
  console.log(`[mock-api] listening on http://localhost:${port}`);
});
