import { z } from 'zod';

export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  /** 403 `reauthentication_required`: a sensitive action needs a fresh re-authentication (F-08 design §8.4). */
  | 'reauth_required'
  /** 403 `csrf_invalid`: the write's CSRF token was missing, expired, or wrong (F-08 design §9.7). */
  | 'csrf'
  | 'not_found'
  | 'validation'
  /** 409: a versioned resource changed since it was read, or the action conflicts with current state. */
  | 'conflict'
  /** 410: the resource expired or was replaced (for example a 2FA enrollment). */
  | 'gone'
  /** 413: the request body exceeded the transport limit. */
  | 'payload_too_large'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'contract';

/**
 * Structured error envelope (F-07 design BCD-2). The backend owns the final
 * shape; if it differs, only this schema changes.
 */
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

type ApiErrorInit = {
  kind: ApiErrorKind;
  status: number | null;
  code?: string;
  message?: string;
  requestId?: string;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  /** From the `Retry-After` header when the backend sent a usable one (e.g. on 429). */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message ?? init.kind);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * Whole seconds to wait from a `Retry-After` value (delta-seconds or an HTTP
 * date, RFC 9110 §10.2.3), or `undefined` when absent or unusable.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // IMF-fixdate only: `Date.parse` alone also accepts values like "-5".
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
    return undefined;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * 403 codes that are not a permission denial and need their own handling
 * (F-08 design §4.5, F8-BCD-7). Every other 403 is `forbidden`.
 */
const FORBIDDEN_CODE_KINDS: Readonly<Record<string, ApiErrorKind>> = {
  reauthentication_required: 'reauth_required',
  csrf_invalid: 'csrf',
};

export function kindForStatus(status: number, code?: string): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return (code && FORBIDDEN_CODE_KINDS[code]) || 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  return 'server';
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const envelope = errorEnvelopeSchema.safeParse(body);
  const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));

  if (!envelope.success) {
    return new ApiError({
      kind: kindForStatus(response.status),
      status: response.status,
      retryAfterSeconds,
    });
  }

  return new ApiError({
    kind: kindForStatus(response.status, envelope.data.error.code),
    status: response.status,
    code: envelope.data.error.code,
    message: envelope.data.error.message,
    requestId: envelope.data.error.request_id,
    details: envelope.data.error.details,
    retryAfterSeconds,
  });
}

/*
 * Customers have no account and never sign in (F-01 F1-17), so no message may
 * point them at a sign-in. A customer 401 means the table session ended.
 */
const USER_MESSAGES: Record<ApiErrorKind, string> = {
  unauthorized: 'Your table session has ended. Scan the QR code on your table to continue.',
  forbidden: "You don't have access to this.",
  reauth_required: 'Confirm your identity to continue.',
  csrf: "We couldn't verify this request. Reload the page and try again.",
  not_found: "We couldn't find what you were looking for.",
  validation: 'Some of the values you entered are not valid.',
  conflict: 'This was changed by someone else. Review the latest values and try again.',
  gone: 'This has expired. Start again.',
  payload_too_large: 'The file is too large to upload.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  server: 'Something went wrong on our side. Try again.',
  network: "We couldn't reach Steward. Check your connection and try again.",
  timeout: 'Steward is taking too long to respond. Try again.',
  contract: 'Something went wrong on our side. Try again.',
};

/** User-facing text. Never exposes raw backend messages or internals. */
export function userMessageFor(error: unknown): string {
  if (error instanceof ApiError) return USER_MESSAGES[error.kind];
  return USER_MESSAGES.server;
}

/**
 * Timeouts are not retried automatically: each attempt already waited the
 * full timeout, so retries would multiply the wait. The user can retry.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'server' || error.kind === 'network');
}
