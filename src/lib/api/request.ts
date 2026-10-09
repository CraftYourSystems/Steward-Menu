import { z } from 'zod';
import { ApiError, apiErrorFromResponse } from './errors';

type QueryScalar = string | number | boolean;
export type QueryValue = QueryScalar | ReadonlyArray<QueryScalar> | null | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export type RequestOptions = { signal?: AbortSignal | undefined };

/**
 * A validated GET. Feature API functions accept one, so the same function
 * works with `serverGet` (server components) and `clientGet` (hooks).
 */
export type ApiGetter = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  params?: QueryParams,
  options?: RequestOptions,
) => Promise<z.output<Schema>>;

/** Builds an API URL. Array values become repeated keys; null/undefined are omitted. */
export function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) url.searchParams.append(key, String(item));
  }

  return url.toString();
}

/**
 * Upper bound for a JSON API request, including reading the body. A backend
 * that never answers must end in an error state, not an endless skeleton.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A signal that aborts on the caller's signal or after `timeoutMs`, whichever
 * comes first. `timedOut()` distinguishes the two.
 */
export function withTimeout(signal: AbortSignal | null | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    timedOut: () => timeout.aborted && !signal?.aborted,
  };
}

/**
 * Converts a failed `fetch` (or body read) into the error callers expect:
 * the caller's own abort is re-thrown unchanged; a timeout or network
 * failure becomes an `ApiError`.
 */
export function requestFailure(
  cause: unknown,
  callerSignal: AbortSignal | null | undefined,
  timedOut: () => boolean,
): unknown {
  if (callerSignal?.aborted) return cause;
  if (timedOut()) return new ApiError({ kind: 'timeout', status: null });
  return new ApiError({ kind: 'network', status: null });
}

/**
 * Performs a GET and validates the JSON body at the API boundary.
 * F-07 reads use only this; writes go through `sendRequest`.
 */
export async function getJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init: Omit<RequestInit, 'method' | 'body'> = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<z.output<Schema>> {
  return requestJson(url, schema, { ...init, method: 'GET' }, timeoutMs);
}

/** Uploads get a longer bound than JSON requests (F-08 design §12.2a). */
export const UPLOAD_TIMEOUT_MS = 60_000;

export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A JSON body, a multipart form, or no body. */
export type WriteBody = { json: unknown } | { form: FormData } | undefined;

/**
 * Performs a state-changing request and validates the response at the API
 * boundary. A 204 has no body, so its schema is `z.undefined()`.
 *
 * Never retries: a write that timed out may still have been applied, and the
 * backend's version check (409) is what makes a manual retry safe.
 */
export async function sendRequest<Schema extends z.ZodType>(
  url: string,
  method: WriteMethod,
  schema: Schema,
  body: WriteBody,
  init: Omit<RequestInit, 'method' | 'body'> = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<z.output<Schema>> {
  const headers = new Headers(init.headers);
  let requestBody: BodyInit | undefined;
  if (body && 'json' in body) {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body.json);
  } else if (body) {
    // The browser sets the multipart boundary; setting Content-Type here would break it.
    requestBody = body.form;
  }
  return requestJson(url, schema, { ...init, method, headers, body: requestBody }, timeoutMs);
}

async function requestJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  init: RequestInit,
  timeoutMs: number,
): Promise<z.output<Schema>> {
  const { signal, timedOut } = withTimeout(init.signal, timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, headers });
  } catch (cause) {
    throw requestFailure(cause, init.signal, timedOut);
  }

  if (!response.ok) throw await apiErrorFromResponse(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // An aborted or timed-out body read is not a contract violation.
    if (signal.aborted) throw requestFailure(cause, init.signal, timedOut);
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Developer-facing only; users see a generic message.
    console.error(`[api] Response from ${url} did not match the expected contract.`, parsed.error);
    throw new ApiError({ kind: 'contract', status: response.status });
  }

  return parsed.data;
}
