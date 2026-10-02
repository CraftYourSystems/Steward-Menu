import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mswServer } from '@/test/msw/node';
import { errorResponse } from '@/test/msw/respond';
import { ApiError, isRetryable, userMessageFor } from './errors';
import { buildUrl, getJson, sendRequest } from './request';

const Schema = z.object({ value: z.number() });
const URL_UNDER_TEST = 'http://api.test/thing';

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

describe('buildUrl', () => {
  it('joins base and path, repeats array params, and omits empty values', () => {
    expect(
      buildUrl('http://api.test/v1', '/orders', {
        range: '7d',
        category_id: ['a', 'b'],
        cursor: null,
        min_total: undefined,
        limit: 50,
      }),
    ).toBe('http://api.test/v1/orders?range=7d&category_id=a&category_id=b&limit=50');
  });
});

describe('getJson', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns data that matches the schema', async () => {
    mswServer.use(http.get(URL_UNDER_TEST, () => HttpResponse.json({ value: 1 })));
    await expect(getJson(URL_UNDER_TEST, Schema)).resolves.toEqual({ value: 1 });
  });

  it('only issues GET requests', async () => {
    let method = '';
    mswServer.use(
      http.all(URL_UNDER_TEST, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ value: 1 });
      }),
    );
    await getJson(URL_UNDER_TEST, Schema);
    expect(method).toBe('GET');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'validation'],
    [400, 'validation'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
  ] as const)('maps HTTP %i to %s and reads the error envelope', async (status, kind) => {
    mswServer.use(
      http.get(URL_UNDER_TEST, () => errorResponse(status, 'code_x', 'Backend text', 'req-1')),
    );
    const error = await captureError(getJson(URL_UNDER_TEST, Schema));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.code).toBe('code_x');
    expect(error.requestId).toBe('req-1');
  });

  it('tolerates an error body that is not the expected envelope', async () => {
    mswServer.use(
      http.get(URL_UNDER_TEST, () => new HttpResponse('<html>oops</html>', { status: 502 })),
    );
    const error = await captureError(getJson(URL_UNDER_TEST, Schema));
    expect(error.kind).toBe('server');
    expect(error.requestId).toBeUndefined();
  });

  it('reports a contract error when the body does not match the schema', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mswServer.use(http.get(URL_UNDER_TEST, () => HttpResponse.json({ value: 'nope' })));
    const error = await captureError(getJson(URL_UNDER_TEST, Schema));
    expect(error.kind).toBe('contract');
  });

  it('reports a network error when the request fails', async () => {
    mswServer.use(http.get(URL_UNDER_TEST, () => HttpResponse.error()));
    const error = await captureError(getJson(URL_UNDER_TEST, Schema));
    expect(error.kind).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('times out when the backend never responds, and does not auto-retry', async () => {
    mswServer.use(http.get(URL_UNDER_TEST, () => delay('infinite')));
    const error = await captureError(getJson(URL_UNDER_TEST, Schema, {}, 50));
    expect(error.kind).toBe('timeout');
    expect(error.status).toBeNull();
    expect(isRetryable(error)).toBe(false);
    expect(userMessageFor(error)).toMatch(/taking too long/);
  });

  it("re-throws the caller's own abort instead of reporting a timeout", async () => {
    mswServer.use(http.get(URL_UNDER_TEST, () => delay('infinite')));
    const controller = new AbortController();
    const request = getJson(URL_UNDER_TEST, Schema, { signal: controller.signal }, 5_000);
    controller.abort();
    await expect(request).rejects.not.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('sendRequest', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends a JSON body with the method and validates the response', async () => {
    let received: { method: string; contentType: string | null; body: unknown } | undefined;
    mswServer.use(
      http.patch(URL_UNDER_TEST, async ({ request }) => {
        received = {
          method: request.method,
          contentType: request.headers.get('content-type'),
          body: await request.json(),
        };
        return HttpResponse.json({ value: 2 });
      }),
    );
    await expect(
      sendRequest(URL_UNDER_TEST, 'PATCH', Schema, { json: { version: 1, name: 'X' } }),
    ).resolves.toEqual({ value: 2 });
    expect(received).toEqual({
      method: 'PATCH',
      contentType: 'application/json',
      body: { version: 1, name: 'X' },
    });
  });

  it('accepts a 204 with z.undefined() and rejects a 204 where a body was expected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mswServer.use(http.delete(URL_UNDER_TEST, () => new HttpResponse(null, { status: 204 })));
    await expect(
      sendRequest(URL_UNDER_TEST, 'DELETE', z.undefined(), undefined),
    ).resolves.toBeUndefined();

    const error = await captureError(sendRequest(URL_UNDER_TEST, 'DELETE', Schema, undefined));
    expect(error.kind).toBe('contract');
  });

  it('makes exactly one request when a write fails (never retries)', async () => {
    let calls = 0;
    mswServer.use(
      http.post(URL_UNDER_TEST, () => {
        calls += 1;
        return errorResponse(503, 'unavailable', 'Down');
      }),
    );
    const error = await captureError(sendRequest(URL_UNDER_TEST, 'POST', Schema, undefined));
    expect(error.kind).toBe('server');
    expect(calls).toBe(1);
  });

  it('times out a write that never answers', async () => {
    mswServer.use(http.post(URL_UNDER_TEST, () => delay('infinite')));
    const error = await captureError(
      sendRequest(URL_UNDER_TEST, 'POST', Schema, { json: {} }, {}, 50),
    );
    expect(error.kind).toBe('timeout');
  });

  it.each([
    [403, 'csrf_invalid', 'csrf'],
    [403, 'reauthentication_required', 'reauth_required'],
    [403, 'forbidden', 'forbidden'],
    [403, 'some_future_code', 'forbidden'],
    [409, 'version_conflict', 'conflict'],
    [410, 'enrollment_expired', 'gone'],
    [413, 'payload_too_large', 'payload_too_large'],
    [422, 'validation_failed', 'validation'],
  ] as const)('maps %i %s to %s', async (status, code, kind) => {
    mswServer.use(http.post(URL_UNDER_TEST, () => errorResponse(status, code, 'Backend text')));
    const error = await captureError(sendRequest(URL_UNDER_TEST, 'POST', Schema, undefined));
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(userMessageFor(error)).not.toContain('Backend text');
  });

  it('treats a 403 without a parsable envelope as forbidden', async () => {
    mswServer.use(http.post(URL_UNDER_TEST, () => new HttpResponse('nope', { status: 403 })));
    const error = await captureError(sendRequest(URL_UNDER_TEST, 'POST', Schema, undefined));
    expect(error.kind).toBe('forbidden');
  });

  it('keeps field-level error details for the form to map', async () => {
    mswServer.use(
      http.patch(URL_UNDER_TEST, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Invalid',
              details: { fields: { pin_code: [{ code: 'invalid_pin_code', message: 'Bad PIN' }] } },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const error = await captureError(
      sendRequest(URL_UNDER_TEST, 'PATCH', Schema, { json: { version: 1 } }),
    );
    expect(error.kind).toBe('validation');
    expect(error.details).toEqual({
      fields: { pin_code: [{ code: 'invalid_pin_code', message: 'Bad PIN' }] },
    });
  });
});

describe('userMessageFor', () => {
  it('never exposes the backend message', () => {
    const error = new ApiError({
      kind: 'server',
      status: 500,
      message: 'psycopg2.OperationalError',
    });
    expect(userMessageFor(error)).not.toContain('psycopg2');
  });
});
