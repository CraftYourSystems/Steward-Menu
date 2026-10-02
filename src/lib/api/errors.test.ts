import { describe, expect, it } from 'vitest';
import { apiErrorFromResponse, parseRetryAfter } from './errors';

const envelope = (code: string) =>
  JSON.stringify({ error: { code, message: 'Too many attempts', request_id: 'req-429' } });

function response(status: number, body: string | null, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-09-27T10:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('reads an HTTP date as seconds from now, rounded up, never negative', () => {
    expect(parseRetryAfter('Sun, 27 Sep 2026 10:00:45 GMT', now)).toBe(45);
    expect(parseRetryAfter('Sun, 27 Sep 2026 09:59:00 GMT', now)).toBe(0);
  });

  it.each([null, '', 'soon', '-5', '1.5'])('returns undefined for %j', (value) => {
    expect(parseRetryAfter(value, now)).toBeUndefined();
  });
});

describe('apiErrorFromResponse — Retry-After', () => {
  it('exposes the header on a 429', async () => {
    const error = await apiErrorFromResponse(
      response(429, envelope('rate_limited'), { 'Retry-After': '30' }),
    );
    expect(error).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 30 });
  });

  it('leaves it undefined when the header is absent', async () => {
    const error = await apiErrorFromResponse(response(429, envelope('rate_limited')));
    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('keeps it even when the body is not a valid envelope', async () => {
    const error = await apiErrorFromResponse(response(429, null, { 'Retry-After': '12' }));
    expect(error).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 12 });
  });

  it('does not change anything else about the error', async () => {
    const error = await apiErrorFromResponse(response(403, envelope('forbidden')));
    expect(error).toMatchObject({
      kind: 'forbidden',
      code: 'forbidden',
      requestId: 'req-429',
      retryAfterSeconds: undefined,
    });
  });
});
