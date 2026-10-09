import { ApiError, userMessageFor } from '@/lib/api/errors';
import { CUSTOMER_NAME_MAX_LENGTH } from './schemas';

export type DetailsField = 'name' | 'mobile';

/** What the customer sees for each documented field code (F-01 technical design §7). */
const FIELD_MESSAGES: Record<string, string> = {
  name_required: 'Enter your name.',
  name_too_long: `Use at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`,
  name_invalid: 'Remove special characters from your name.',
  mobile_invalid: 'Enter a 10-digit Indian mobile number, for example 98765 43210.',
};

export type DetailsProblem =
  | { kind: 'fields'; fields: Partial<Record<DetailsField, string>> }
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'session_ended' }
  | { kind: 'error'; message: string; requestId: string | undefined };

export function detailsProblemFor(error: unknown): DetailsProblem {
  if (!(error instanceof ApiError)) {
    return { kind: 'error', message: userMessageFor(error), requestId: undefined };
  }
  if (error.kind === 'unauthorized') return { kind: 'session_ended' };
  if (error.kind === 'rate_limited') {
    return { kind: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
  }
  const fields = error.details?.fields as Record<string, { code?: string }[]> | undefined;
  if (error.kind === 'validation' && fields) {
    const result: Partial<Record<DetailsField, string>> = {};
    for (const field of ['name', 'mobile'] as const) {
      const code = fields[field]?.[0]?.code;
      if (code) result[field] = FIELD_MESSAGES[code] ?? userMessageFor(error);
    }
    if (Object.keys(result).length > 0) return { kind: 'fields', fields: result };
  }
  return { kind: 'error', message: userMessageFor(error), requestId: error.requestId };
}
