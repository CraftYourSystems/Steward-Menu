import { http, HttpResponse } from 'msw';
import {
  buildCustomerMenu,
  buildEmptyCustomerMenu,
  buildEnteredSession,
  MOCK_TABLES,
} from '@/test/factories/customer';
import { resolveMockScenario } from '../mock-scenario';
import { errorResponse } from '../respond';

/*
 * Customer QR entry and menu (F-01 S1), shaped like FastAPI's. The mock keeps
 * the customer session in the same cookie name the backend uses, so a browser
 * against the standalone mock API resumes, conflicts and expires the way it
 * would against FastAPI. The cookie value is a mock marker, not a real token.
 */

const COOKIE = 'steward_customer_session';
const MARKER = 'mock-session.';

function sessionQr(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== COOKIE) continue;
    const value = rest.join('=');
    if (!value.startsWith(MARKER)) return undefined;
    const qr = value.slice(MARKER.length);
    return MOCK_TABLES[qr] ? qr : undefined;
  }
  return undefined;
}

function sessionCookie(qr: string): string {
  return `${COOKIE}=${MARKER}${qr}; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export const customerHandlers = [
  http.post('*/customer/sessions', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { qr_code?: unknown } | null;
    const qr = typeof body?.qr_code === 'string' ? body.qr_code : '';
    const table = MOCK_TABLES[qr];
    if (!table) return errorResponse(404, 'not_found', 'The requested resource was not found.');
    if (!table.active) return errorResponse(409, 'table_unavailable', 'Unavailable');

    const current = sessionQr(request);
    if (current && current !== qr) {
      return HttpResponse.json(
        {
          error: {
            code: 'customer_session_other_table',
            message: 'Your order is already started at another table.',
            request_id: 'req-mock-other-table',
            details: { table_number: MOCK_TABLES[current]?.number },
          },
        },
        { status: 409 },
      );
    }
    return HttpResponse.json(buildEnteredSession(table.number), {
      status: current === qr ? 200 : 201,
      headers: { 'Set-Cookie': sessionCookie(qr), 'Cache-Control': 'no-store' },
    });
  }),

  http.get('*/customer/menu', ({ request }) => {
    if (!sessionQr(request)) {
      return errorResponse(401, 'customer_session_expired', 'Session ended');
    }
    const scenario = resolveMockScenario(request);
    if (scenario === 'server_error') {
      return errorResponse(500, 'internal_error', 'Internal error', 'req-menu-500');
    }
    return HttpResponse.json(scenario === 'empty' ? buildEmptyCustomerMenu() : buildCustomerMenu());
  }),
];
