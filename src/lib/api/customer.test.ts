import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mswServer } from '@/test/msw/node';
import { customerGet, customerSend } from './customer';

const Schema = z.object({ ok: z.boolean() });
/** The restaurant-user synchronizer CSRF header, which customer writes never carry (F1-23). */
const CSRF_HEADER = 'X-CSRF-Token';

function recordRequests() {
  const seen: { path: string; csrf: string | null; body: string }[] = [];
  mswServer.events.on('request:start', async ({ request }) => {
    seen.push({
      path: new URL(request.url).pathname,
      csrf: request.headers.get(CSRF_HEADER),
      body: await request.clone().text(),
    });
  });
  return seen;
}

afterEach(() => {
  mswServer.events.removeAllListeners();
  vi.restoreAllMocks();
});

describe('customerSend', () => {
  it('sends credentials so the browser keeps the HttpOnly customer cookie', async () => {
    mswServer.use(http.post('*/customer/thing', () => HttpResponse.json({ ok: true })));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      customerSend('/customer/thing', 'POST', Schema, { json: { qr_code: 'x' } }),
    ).resolves.toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/customer/thing');
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
  });

  it('never requests /auth/csrf and sends no synchronizer token (F1-23)', async () => {
    mswServer.use(http.post('*/customer/thing', () => HttpResponse.json({ ok: true })));
    const seen = recordRequests();

    await customerSend('/customer/thing', 'POST', Schema, { json: { qr_code: 'abc' } });

    expect(seen.map((request) => request.path)).toEqual(['/customer/thing']);
    expect(seen[0]?.csrf).toBeNull();
    expect(seen[0]?.body).toBe('{"qr_code":"abc"}');
  });
});

describe('customerGet', () => {
  it('sends credentials and validates the response', async () => {
    mswServer.use(http.get('*/customer/thing', () => HttpResponse.json({ ok: true })));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(customerGet('/customer/thing', Schema)).resolves.toEqual({ ok: true });
    expect(fetchSpy.mock.calls[0]?.[1]?.credentials).toBe('include');
  });

  it('rejects a response that breaks the contract', async () => {
    mswServer.use(http.get('*/customer/thing', () => HttpResponse.json({ ok: 'yes' })));
    await expect(customerGet('/customer/thing', Schema)).rejects.toMatchObject({
      kind: 'contract',
    });
  });
});
