import { HttpResponse } from 'msw';

/** Error body in the assumed envelope (F-07 design BCD-2). */
export function errorResponse(status: number, code: string, message: string, requestId?: string) {
  return HttpResponse.json(
    { error: { code, message, ...(requestId ? { request_id: requestId } : {}) } },
    { status },
  );
}
