import { http, HttpResponse } from 'msw';
import {
  buildCart,
  buildCartLine,
  buildCheckout,
  buildCustomerMenu,
  buildEmptyCustomerMenu,
  buildEnteredSession,
  MOCK_DISHES,
  MOCK_TABLES,
  MOCK_TAX_RATE_BP,
} from '@/test/factories/customer';
import { resolveMockScenario, type MockScenario } from '../mock-scenario';
import { errorResponse } from '../respond';

/*
 * Customer QR entry, menu (F-01 S1), cart (S2), details and Review (S3), shaped
 * like FastAPI's. The mock keeps the customer session in the same cookie name
 * the backend uses, so a browser against the standalone mock API resumes,
 * conflicts and expires the way it would against FastAPI. The cookie value is a
 * mock marker (`mock-session.<qr>.<id>`), not a real token; each new session
 * gets a new id and its own empty state.
 *
 * The rules mirror the backend: a line is (dish, normalized instructions);
 * quantity 1 to 20; current prices; unavailable lines kept and left out of the
 * subtotal; Name + Indian mobile normalized to E.164; Review prices the cart at
 * 500 basis points, half up; every cart or details change and every new Review
 * supersede the open checkout; reading the checkout never creates one.
 * Scenarios only select fixtures.
 */

const COOKIE = 'steward_customer_session';
const MARKER = 'mock-session.';
const MAX_QUANTITY = 20;
const MAX_INSTRUCTIONS = 200;
const MAX_NAME = 80;

type MockSession = { qr: string; value: string };
type MockLine = { id: string; itemId: string; quantity: number; instructions: string | null };
type MockState = {
  lines: MockLine[];
  details: { name: string; mobile: string } | null;
  checkout: ReturnType<typeof buildCheckout> | null;
};

const states = new Map<string, MockState>();
let nextId = 1;

function stateOf(session: MockSession): MockState {
  let state = states.get(session.value);
  if (!state) {
    state = { lines: [], details: null, checkout: null };
    states.set(session.value, state);
  }
  return state;
}

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

/** Vitest: the device's session ends (as after 5 idle minutes): cart, details and review go. */
export function endMockDeviceSession() {
  if (cookielessDevice.session) states.delete(cookielessDevice.session.value);
  cookielessDevice.session = undefined;
}

/** Forgets every mock session state and the cookieless device (tests). */
export function resetMockCarts() {
  states.clear();
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

const NO_STORE = { 'Cache-Control': 'no-store' };

function sessionExpired() {
  return errorResponse(401, 'customer_session_expired', 'Session ended');
}

function notFound() {
  return errorResponse(404, 'not_found', 'The requested resource was not found.');
}

function conflict(code: string, message: string, details?: Record<string, unknown>) {
  return HttpResponse.json(
    { error: { code, message, request_id: `req-mock-${code}`, ...(details ? { details } : {}) } },
    { status: 409 },
  );
}

function validation(fields: Record<string, string>) {
  return HttpResponse.json(
    {
      error: {
        code: 'validation_failed',
        message: 'Some of the submitted values are not valid.',
        request_id: 'req-mock-validation',
        details: {
          fields: Object.fromEntries(
            Object.entries(fields).map(([field, code]) => [
              field,
              [{ code, message: 'Invalid value.' }],
            ]),
          ),
        },
      },
    },
    { status: 422 },
  );
}

/** In the `dal_unavailable` scenario Dal Makhani has become unavailable. */
function isAvailable(itemId: string, scenario: MockScenario): boolean {
  return !(scenario === 'dal_unavailable' && itemId === MOCK_DISHES.dal.id);
}

function dish(itemId: string) {
  return Object.values(MOCK_DISHES).find((candidate) => candidate.id === itemId);
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Backend rule (§8): controls stripped (line breaks become spaces), trimmed, empty is null. */
function normalizeInstructions(value: string | null): string | null | 'too_long' {
  if (value === null) return null;
  const text = value
    .replace(/[\t\n\r\v\f]/g, ' ')
    .replace(CONTROL, '')
    .trim();
  if (!text) return null;
  return [...text].length > MAX_INSTRUCTIONS ? 'too_long' : text;
}

/** Backend rule (§7, TD-15): the national number of an accepted Indian mobile input. */
function nationalMobile(value: string): string | null {
  const compact = value.trim().replace(/[ -]/g, '');
  for (const prefix of ['+91', '91', '0', '']) {
    if (compact.startsWith(prefix) && compact.length === prefix.length + 10) {
      const national = compact.slice(prefix.length);
      if (/^[6-9][0-9]{9}$/.test(national)) return national;
    }
  }
  return null;
}

function cartResponse(session: MockSession, scenario: MockScenario) {
  const lines = stateOf(session).lines.flatMap((line) => {
    const item = dish(line.itemId);
    return item
      ? [
          buildCartLine(item, line.quantity, {
            id: line.id,
            available: isAvailable(line.itemId, scenario),
            specialInstructions: line.instructions,
          }),
        ]
      : [];
  });
  return HttpResponse.json(buildCart(lines), { headers: NO_STORE });
}

function isQuantity(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY
  );
}

function onlyKeys(body: unknown, allowed: string[]): body is Record<string, unknown> {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).every((key) => allowed.includes(key))
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

/** Every cart or details change supersedes the open checkout, as on the backend (§11). */
function changed(session: MockSession) {
  stateOf(session).checkout = null;
}

export const customerHandlers = [
  http.post('*/customer/sessions', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { qr_code?: unknown } | null;
    const qr = typeof body?.qr_code === 'string' ? body.qr_code : '';
    const table = MOCK_TABLES[qr];
    if (!table) return notFound();
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
    // Resuming keeps the same session (and its state); otherwise a new one starts.
    const value = current?.value ?? `${MARKER}${qr}.${nextId++}`;
    if (cookielessDevice.enabled && !current) cookielessDevice.session = { qr, value };
    return HttpResponse.json(buildEnteredSession(table.number), {
      status: current ? 200 : 201,
      // The cookieless Vitest device has no cookie jar, so it gets no cookie.
      headers: cookielessDevice.enabled
        ? NO_STORE
        : { 'Set-Cookie': sessionCookie(value), ...NO_STORE },
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
    if (
      !onlyKeys(body, ['menu_item_id', 'quantity', 'special_instructions']) ||
      typeof body.menu_item_id !== 'string' ||
      !('quantity' in body) ||
      (body.special_instructions !== undefined &&
        body.special_instructions !== null &&
        typeof body.special_instructions !== 'string')
    ) {
      return validation({ request: 'invalid' });
    }
    if (!isQuantity(body.quantity)) return validation({ quantity: 'invalid' });
    const item = dish(body.menu_item_id);
    if (!item) return notFound();
    if (!isAvailable(item.id, scenario)) {
      return errorResponse(422, 'item_unavailable', "This dish isn't available right now.");
    }
    const instructions = normalizeInstructions(
      (body.special_instructions as string | null | undefined) ?? null,
    );
    if (instructions === 'too_long') {
      return validation({ special_instructions: 'special_instructions_too_long' });
    }
    const state = stateOf(session);
    const existing = state.lines.find(
      (line) => line.itemId === item.id && line.instructions === instructions,
    );
    if (existing) {
      if (existing.quantity + body.quantity > MAX_QUANTITY) {
        return validation({ quantity: 'cart_line_quantity_max' });
      }
      existing.quantity += body.quantity;
    } else {
      state.lines.push({
        id: `line-${nextId++}`,
        itemId: item.id,
        quantity: body.quantity,
        instructions,
      });
    }
    changed(session);
    return cartResponse(session, scenario);
  }),

  http.patch('*/customer/cart/lines/:lineId', async ({ request, params }) => {
    const session = writeGuard(request);
    if (session instanceof Response) return session;
    const scenario = resolveMockScenario(request);
    const body: unknown = await request.json().catch(() => null);
    if (!onlyKeys(body, ['quantity', 'special_instructions']) || Object.keys(body).length === 0) {
      return validation({ request: 'invalid' });
    }
    if ('quantity' in body && !isQuantity(body.quantity))
      return validation({ quantity: 'invalid' });
    const state = stateOf(session);
    const line = state.lines.find((candidate) => candidate.id === params.lineId);
    if (!line) return notFound();
    let quantity = 'quantity' in body ? (body.quantity as number) : line.quantity;
    if (quantity > line.quantity && !isAvailable(line.itemId, scenario)) {
      return errorResponse(422, 'item_unavailable', "This dish isn't available right now.");
    }
    let instructions = line.instructions;
    if ('special_instructions' in body) {
      const given = body.special_instructions;
      if (given !== null && typeof given !== 'string') return validation({ request: 'invalid' });
      const normalized = normalizeInstructions(given);
      if (normalized === 'too_long') {
        return validation({ special_instructions: 'special_instructions_too_long' });
      }
      instructions = normalized;
    }
    if (instructions !== line.instructions) {
      const other = state.lines.find(
        (candidate) =>
          candidate.id !== line.id &&
          candidate.itemId === line.itemId &&
          candidate.instructions === instructions,
      );
      if (other) {
        if (quantity + other.quantity > MAX_QUANTITY) {
          return validation({ quantity: 'cart_line_quantity_max' });
        }
        quantity += other.quantity;
        state.lines = state.lines.filter((candidate) => candidate.id !== other.id);
      }
    }
    line.quantity = quantity;
    line.instructions = instructions;
    changed(session);
    return cartResponse(session, scenario);
  }),

  http.delete('*/customer/cart/lines/:lineId', ({ request, params }) => {
    const session = writeGuard(request);
    if (session instanceof Response) return session;
    const state = stateOf(session);
    if (!state.lines.some((line) => line.id === params.lineId)) return notFound();
    state.lines = state.lines.filter((line) => line.id !== params.lineId);
    changed(session);
    return cartResponse(session, resolveMockScenario(request));
  }),

  http.get('*/customer/details', ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const details = stateOf(session).details;
    return HttpResponse.json(
      { data: { name: details?.name ?? null, mobile: details?.mobile ?? null } },
      { headers: NO_STORE },
    );
  }),

  http.put('*/customer/details', async ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const body: unknown = await request.json().catch(() => null);
    if (
      !onlyKeys(body, ['name', 'mobile']) ||
      typeof body.name !== 'string' ||
      typeof body.mobile !== 'string'
    ) {
      return validation({ request: 'invalid' });
    }
    const errors: Record<string, string> = {};
    const name = body.name.trim();
    if (CONTROL.test(name)) errors.name = 'name_invalid';
    else if (!name) errors.name = 'name_required';
    else if ([...name].length > MAX_NAME) errors.name = 'name_too_long';
    CONTROL.lastIndex = 0;
    const national = nationalMobile(body.mobile);
    if (!national) errors.mobile = 'mobile_invalid';
    if (Object.keys(errors).length > 0) return validation(errors);
    const details = { name, mobile: `+91${national}` };
    stateOf(session).details = details;
    changed(session);
    return HttpResponse.json({ data: details }, { headers: NO_STORE });
  }),

  http.get('*/customer/checkout', ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const checkout = stateOf(session).checkout;
    return checkout ? HttpResponse.json(checkout, { headers: NO_STORE }) : notFound();
  }),

  http.post('*/customer/checkout/review', ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const scenario = resolveMockScenario(request);
    const state = stateOf(session);
    if (state.lines.length === 0) return conflict('cart_empty', 'Your cart is empty.');
    if (!state.details) {
      return conflict('customer_details_required', 'Enter your name and mobile number.');
    }
    if (scenario === 'table_inactive') {
      return conflict('table_unavailable', 'This table is not taking orders right now.');
    }
    const unavailable = [
      ...new Set(
        state.lines.filter((line) => !isAvailable(line.itemId, scenario)).map((l) => l.itemId),
      ),
    ];
    if (unavailable.length > 0) {
      return conflict('checkout_revalidation_required', 'Some dishes are no longer available.', {
        unavailable_item_ids: unavailable,
      });
    }
    if (scenario === 'tax_missing') {
      return conflict('restaurant_configuration_incomplete', "This restaurant can't take orders.", {
        missing: ['tax_rate'],
      });
    }
    state.checkout = buildCheckout({
      checkoutId: `checkout-${nextId++}`,
      name: state.details.name,
      mobile: state.details.mobile,
      tableNumber: MOCK_TABLES[session.qr]?.number ?? '1',
      rateBp: MOCK_TAX_RATE_BP,
      lines: state.lines.flatMap((line) => {
        const item = dish(line.itemId);
        return item
          ? [{ dish: item, quantity: line.quantity, specialInstructions: line.instructions }]
          : [];
      }),
    });
    return HttpResponse.json(state.checkout, { status: 201, headers: NO_STORE });
  }),
];
