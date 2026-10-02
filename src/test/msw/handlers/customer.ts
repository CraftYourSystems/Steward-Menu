import { http, HttpResponse } from 'msw';
import {
  buildCart,
  buildCartLine,
  buildCustomerMenu,
  buildEmptyCustomerMenu,
  buildEnteredSession,
  MOCK_DISHES,
  MOCK_TABLES,
} from '@/test/factories/customer';
import { resolveMockScenario, type MockScenario } from '../mock-scenario';
import { errorResponse } from '../respond';

/*
 * Customer QR entry, menu (F-01 S1) and cart (S2), shaped like FastAPI's. The
 * mock keeps the customer session in the same cookie name the backend uses, so
 * a browser against the standalone mock API resumes, conflicts and expires the
 * way it would against FastAPI. The cookie value is a mock marker
 * (`mock-session.<qr>.<id>`), not a real token; each new session gets a new id
 * and its own empty cart. The cart rules mirror the backend: one line per dish,
 * quantity 1 to 20, current prices, unavailable lines kept and left out of the
 * subtotal. Scenarios only select fixtures.
 */

const COOKIE = 'steward_customer_session';
const MARKER = 'mock-session.';
const MAX_QUANTITY = 20;

type MockSession = { qr: string; value: string };
type MockLine = { id: string; itemId: string; quantity: number };

const carts = new Map<string, MockLine[]>();
let nextId = 1;

/*
 * jsdom has no cookie jar for the HttpOnly cookie. Vitest tests opt into one
 * implicit device instead: its session behaves exactly like a cookie session
 * (resume, a new session after it ends), without a cookie.
 */
let cookielessDevice: { enabled: boolean; session: MockSession | undefined } = {
  enabled: false,
  session: undefined,
};

/** Vitest: the handlers keep one device session without a cookie. */
export function useCookielessMockDevice() {
  cookielessDevice = { enabled: true, session: undefined };
}

/** Vitest: the device's session ends (as after 5 idle minutes); its cart is gone. */
export function endMockDeviceSession() {
  if (cookielessDevice.session) carts.delete(cookielessDevice.session.value);
  cookielessDevice.session = undefined;
}

/** Forgets every mock cart and the cookieless device (tests). */
export function resetMockCarts() {
  carts.clear();
  nextId = 1;
  cookielessDevice = { enabled: false, session: undefined };
}

function currentSession(request: Request): MockSession | undefined {
  return (
    cookieSession(request) ?? (cookielessDevice.enabled ? cookielessDevice.session : undefined)
  );
}

function cookieSession(request: Request): MockSession | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== COOKIE) continue;
    const value = rest.join('=');
    if (!value.startsWith(MARKER)) return undefined;
    const [qr] = value.slice(MARKER.length).split('.');
    return qr && MOCK_TABLES[qr] ? { qr, value } : undefined;
  }
  return undefined;
}

function sessionCookie(value: string): string {
  return `${COOKIE}=${value}; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function sessionExpired() {
  return errorResponse(401, 'customer_session_expired', 'Session ended');
}

/** In the `dal_unavailable` scenario Dal Makhani has become unavailable. */
function isAvailable(itemId: string, scenario: MockScenario): boolean {
  return !(scenario === 'dal_unavailable' && itemId === MOCK_DISHES.dal.id);
}

function dish(itemId: string) {
  return Object.values(MOCK_DISHES).find((candidate) => candidate.id === itemId);
}

function cartResponse(session: MockSession, scenario: MockScenario) {
  const lines = (carts.get(session.value) ?? []).flatMap((line) => {
    const item = dish(line.itemId);
    return item
      ? [
          buildCartLine(item, line.quantity, {
            id: line.id,
            available: isAvailable(line.itemId, scenario),
          }),
        ]
      : [];
  });
  return HttpResponse.json(buildCart(lines), { headers: { 'Cache-Control': 'no-store' } });
}

function invalidQuantity(field = 'quantity', code = 'invalid') {
  return HttpResponse.json(
    {
      error: {
        code: 'validation_failed',
        message: 'Some of the submitted values are not valid.',
        request_id: 'req-mock-validation',
        details: { fields: { [field]: [{ code, message: 'Invalid value.' }] } },
      },
    },
    { status: 422 },
  );
}

function isQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY
  );
}

function hasExactly(body: unknown, keys: string[]): body is Record<string, unknown> {
  return (
    typeof body === 'object' &&
    body !== null &&
    Object.keys(body).sort().join() === [...keys].sort().join()
  );
}

/** A cart write: needs a session, and the `cart_rate_limited` scenario refuses it. */
function writeGuard(request: Request): MockSession | Response {
  const session = currentSession(request);
  if (!session) return sessionExpired();
  if (resolveMockScenario(request) === 'cart_rate_limited') {
    return HttpResponse.json(
      {
        error: { code: 'rate_limited', message: 'Too many requests.', request_id: 'req-mock-429' },
      },
      { status: 429, headers: { 'Retry-After': '30' } },
    );
  }
  return session;
}

export const customerHandlers = [
  http.post('*/customer/sessions', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { qr_code?: unknown } | null;
    const qr = typeof body?.qr_code === 'string' ? body.qr_code : '';
    const table = MOCK_TABLES[qr];
    if (!table) return errorResponse(404, 'not_found', 'The requested resource was not found.');
    if (!table.active) return errorResponse(409, 'table_unavailable', 'Unavailable');

    const current = currentSession(request);
    if (current && current.qr !== qr) {
      return HttpResponse.json(
        {
          error: {
            code: 'customer_session_other_table',
            message: 'Your order is already started at another table.',
            request_id: 'req-mock-other-table',
            details: { table_number: MOCK_TABLES[current.qr]?.number },
          },
        },
        { status: 409 },
      );
    }
    // Resuming keeps the same session (and cart); otherwise a new one starts.
    const value = current?.value ?? `${MARKER}${qr}.${nextId++}`;
    if (cookielessDevice.enabled && !current) cookielessDevice.session = { qr, value };
    return HttpResponse.json(buildEnteredSession(table.number), {
      status: current ? 200 : 201,
      // The cookieless Vitest device has no cookie jar, so it gets no cookie.
      headers: cookielessDevice.enabled
        ? { 'Cache-Control': 'no-store' }
        : { 'Set-Cookie': sessionCookie(value), 'Cache-Control': 'no-store' },
    });
  }),

  http.get('*/customer/menu', ({ request }) => {
    if (!currentSession(request)) return sessionExpired();
    const scenario = resolveMockScenario(request);
    if (scenario === 'server_error') {
      return errorResponse(500, 'internal_error', 'Internal error', 'req-menu-500');
    }
    if (scenario === 'empty') return HttpResponse.json(buildEmptyCustomerMenu());
    const menu = buildCustomerMenu();
    if (scenario === 'dal_unavailable') {
      menu.data.categories = menu.data.categories
        .map((category) => ({
          ...category,
          items: category.items.filter((item) => item.id !== MOCK_DISHES.dal.id),
        }))
        .filter((category) => category.items.length > 0);
    }
    return HttpResponse.json(menu);
  }),

  http.get('*/customer/cart', ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    return cartResponse(session, resolveMockScenario(request));
  }),

  http.post('*/customer/cart/lines', async ({ request }) => {
    const session = writeGuard(request);
    if (session instanceof Response) return session;
    const scenario = resolveMockScenario(request);
    const body: unknown = await request.json().catch(() => null);
    if (!hasExactly(body, ['menu_item_id', 'quantity']) || typeof body.menu_item_id !== 'string') {
      return invalidQuantity('request');
    }
    if (!isQuantity(body.quantity)) return invalidQuantity();
    const item = dish(body.menu_item_id);
    if (!item) return errorResponse(404, 'not_found', 'The requested resource was not found.');
    if (!isAvailable(item.id, scenario)) {
      return errorResponse(422, 'item_unavailable', "This dish isn't available right now.");
    }
    const lines = carts.get(session.value) ?? [];
    const existing = lines.find((line) => line.itemId === item.id);
    if (existing) {
      if (existing.quantity + body.quantity > MAX_QUANTITY) {
        return invalidQuantity('quantity', 'cart_line_quantity_max');
      }
      existing.quantity += body.quantity;
    } else {
      lines.push({ id: `line-${nextId++}`, itemId: item.id, quantity: body.quantity });
    }
    carts.set(session.value, lines);
    return cartResponse(session, scenario);
  }),

  http.patch('*/customer/cart/lines/:lineId', async ({ request, params }) => {
    const session = writeGuard(request);
    if (session instanceof Response) return session;
    const scenario = resolveMockScenario(request);
    const body: unknown = await request.json().catch(() => null);
    if (!hasExactly(body, ['quantity']) || !isQuantity(body.quantity)) return invalidQuantity();
    const line = carts.get(session.value)?.find((candidate) => candidate.id === params.lineId);
    if (!line) return errorResponse(404, 'not_found', 'The requested resource was not found.');
    if (body.quantity > line.quantity && !isAvailable(line.itemId, scenario)) {
      return errorResponse(422, 'item_unavailable', "This dish isn't available right now.");
    }
    line.quantity = body.quantity;
    return cartResponse(session, scenario);
  }),

  http.delete('*/customer/cart/lines/:lineId', ({ request, params }) => {
    const session = writeGuard(request);
    if (session instanceof Response) return session;
    const lines = carts.get(session.value) ?? [];
    if (!lines.some((line) => line.id === params.lineId)) {
      return errorResponse(404, 'not_found', 'The requested resource was not found.');
    }
    carts.set(
      session.value,
      lines.filter((line) => line.id !== params.lineId),
    );
    return cartResponse(session, resolveMockScenario(request));
  }),
];
