import { http, HttpResponse } from 'msw';
import {
  buildCart,
  buildCartLine,
  buildCheckout,
  buildCustomerMenu,
  buildEmptyCustomerMenu,
  buildEnteredSession,
  buildPaymentSummary,
  MOCK_DISHES,
  MOCK_RESTAURANT_NAME,
  MOCK_TABLES,
  MOCK_TAX_RATE_BP,
  type WireAttemptStatus,
} from '@/test/factories/customer';
import { resolveMockScenario, selectMockScenario, type MockScenario } from '../mock-scenario';
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
 *
 * Payments (S4) mirror the backend too: Pay revalidates an open checkout, then
 * starts it (`payment_started`; cart, details and Review answer `cart_locked`);
 * an awaiting attempt answers Pay with its stored redirect; at most 5 attempts;
 * a retry re-checks availability only; release needs every attempt settled.
 * The redirect goes to a mock gateway page on this mock API (Fail, Cancel,
 * Leave pending) that sends the browser back to the app's return page. The
 * customer's return changes nothing: only a status poll applies the outcome,
 * and the mock never reports a payment as paid.
 *
 * Orders (S6) mirror the backend: the placing session reads its order until
 * Completed, which ends that session; an SMS link's secret redeems into an
 * order-access grant cookie (`steward_order_access`) that reads the one order
 * until the link expires; every refusal is the same 404. Mock-only control
 * routes (`/mock-control/orders/...`) stand in for the kitchen and service
 * staff (F-05) and for an SMS: advance the status, read the link, expire it.
 * Scenarios only select fixtures.
 */

const COOKIE = 'steward_customer_session';
const MARKER = 'mock-session.';
const MAX_QUANTITY = 20;
const MAX_INSTRUCTIONS = 200;
const MAX_NAME = 80;

type MockSession = { qr: string; value: string };
type MockLine = { id: string; itemId: string; quantity: number; instructions: string | null };
type MockAttempt = {
  id: string;
  status: WireAttemptStatus;
  /** What the customer chose on the mock gateway page; applied by a status poll. */
  outcome: 'failed' | 'abandoned' | 'success' | null;
  redirectUrl: string | null;
  returnUrl: string;
};
type MockState = {
  lines: MockLine[];
  details: { name: string; mobile: string } | null;
  checkout: ReturnType<typeof buildCheckout> | null;
  /** S4: the checkout's payment started; the cart is locked. */
  paying: boolean;
  attempts: MockAttempt[];
  /** S5: what the verified payment did. */
  placement:
    | { status: 'placed'; orderId: string; tokenNumber: string; placedAt: string }
    | { status: 'paid_not_placed' }
    | null;
};

let nextToken = 1;

const MAX_ATTEMPTS = 5;
const attemptsById = new Map<string, MockAttempt>();

const states = new Map<string, MockState>();
let nextId = 1;

/* S6: placed orders, order-access grants and the realtime event feed. */
type OrderStatus = 'placed' | 'cooking' | 'ready_to_serve' | 'completed';
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: 'cooking',
  cooking: 'ready_to_serve',
  ready_to_serve: 'completed',
};
type MockOrder = {
  id: string;
  qr: string;
  tableNumber: string;
  tokenNumber: string;
  placedAt: string;
  status: OrderStatus;
  history: { state: OrderStatus; occurred_at: string }[];
  checkout: NonNullable<MockState['checkout']>['data'];
  /** The placing session's cookie value, until Completed ends that session. */
  sessionValue: string | null;
  /** The SMS link's secret (a real backend stores only its hash). */
  secret: string;
  linkExpired: boolean;
};
export type MockOrderEvent = {
  event_id: string;
  type: 'order.status_changed';
  occurred_at: string;
  order_id: string;
  order_status: OrderStatus;
};
const GRANT_COOKIE = 'steward_order_access';
const GRANT_MARKER = 'mock-grant.';
const orders = new Map<string, MockOrder>();
/** Grant cookie value → order ID. */
const grants = new Map<string, string>();
/** Sessions that ended at Completed: their cookie no longer resumes them. */
const endedSessions = new Set<string>();
let nextEvent = 1;
const orderListeners = new Set<(event: MockOrderEvent) => void>();

/** The standalone mock API's WebSocket subscribes here. */
export function onMockOrderEvent(listener: (event: MockOrderEvent) => void): () => void {
  orderListeners.add(listener);
  return () => orderListeners.delete(listener);
}

function orderRef(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The SMS link of an order (path and fragment), as the placement SMS carries it. */
export function mockOrderLink(orderId: string): string | null {
  const order = orders.get(orderId);
  return order ? `/t/${order.qr}/orders/${order.id}#k=${order.secret}` : null;
}

/** The link and every grant made from it expire (7 days on the backend). */
export function expireMockOrderLink(orderId: string): boolean {
  const order = orders.get(orderId);
  if (!order) return false;
  order.linkExpired = true;
  return true;
}

/**
 * Kitchen or service staff move the order on (F-05 §6, via the backend's
 * transition service): one history entry, one event; Completed ends the
 * placing session (F1-37).
 */
export function advanceMockOrder(orderId: string): OrderStatus | null {
  const order = orders.get(orderId);
  const next = order ? NEXT_STATUS[order.status] : undefined;
  if (!order || !next) return null;
  const now = new Date().toISOString();
  order.status = next;
  order.history.push({ state: next, occurred_at: now });
  if (next === 'completed' && order.sessionValue) {
    endedSessions.add(order.sessionValue);
    states.delete(order.sessionValue);
    if (cookielessDevice.session?.value === order.sessionValue) {
      cookielessDevice.session = undefined;
    }
    order.sessionValue = null;
  }
  const event: MockOrderEvent = {
    event_id: `mock-event-${nextEvent++}`,
    type: 'order.status_changed',
    occurred_at: now,
    order_id: order.id,
    order_status: next,
  };
  orderListeners.forEach((listener) => listener(event));
  return next;
}

function cookieValue(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function grantedOrder(cookieHeader: string | null | undefined): MockOrder | undefined {
  const value =
    cookieValue(cookieHeader, GRANT_COOKIE) ??
    (cookielessDevice.enabled ? cookielessDevice.grant : undefined);
  const orderId = value ? grants.get(value) : undefined;
  const order = orderId ? orders.get(orderId) : undefined;
  return order && !order.linkExpired ? order : undefined;
}

function sessionOrder(session: MockSession | undefined): MockOrder | undefined {
  if (!session) return undefined;
  const placement = states.get(session.value)?.placement;
  const order = placement?.status === 'placed' ? orders.get(placement.orderId) : undefined;
  return order && order.sessionValue === session.value ? order : undefined;
}

/**
 * What a customer WebSocket with these cookies may hear (§25): the session's
 * order and the grant's order, decided here, never by the client.
 */
export function mockSocketAccess(cookieHeader: string | undefined) {
  const value = cookieValue(cookieHeader, COOKIE);
  const session =
    value && value.startsWith(MARKER) && !endedSessions.has(value)
      ? { qr: value.slice(MARKER.length).split('.')[0] ?? '', value }
      : undefined;
  return {
    sessionOrderId: sessionOrder(session)?.id ?? null,
    grantOrderId: grantedOrder(cookieHeader)?.id ?? null,
  };
}

function orderResponse(order: MockOrder) {
  const checkout = order.checkout;
  return {
    data: {
      order_ref: order.id,
      token_number: order.tokenNumber,
      status: order.status,
      placed_at: order.placedAt,
      restaurant: { name: MOCK_RESTAURANT_NAME },
      table: { number: order.tableNumber },
      items: checkout.lines,
      amounts: checkout.amounts,
      history: order.history,
    },
  };
}

function stateOf(session: MockSession): MockState {
  let state = states.get(session.value);
  if (!state) {
    state = {
      lines: [],
      details: null,
      checkout: null,
      paying: false,
      attempts: [],
      placement: null,
    };
    states.set(session.value, state);
  }
  return state;
}

/*
 * jsdom has no cookie jar for the HttpOnly cookie. Vitest tests opt into one
 * implicit device instead: its session behaves exactly like a cookie session
 * (resume, a new session after it ends), without a cookie.
 */
let cookielessDevice: {
  enabled: boolean;
  session: MockSession | undefined;
  /** S6: the device's order-access grant (the `steward_order_access` cookie). */
  grant?: string | undefined;
} = {
  enabled: false,
  session: undefined,
};

/** Vitest: the handlers keep one device session without a cookie. */
export function useCookielessMockDevice() {
  cookielessDevice = { enabled: true, session: undefined };
}

/** Vitest: continue as another device (no session, no grant), e.g. to open an SMS link. */
export function useAnotherMockDevice() {
  cookielessDevice = { enabled: true, session: undefined, grant: undefined };
}

/** Vitest: the device's session ends (as after 5 idle minutes): cart, details and review go. */
export function endMockDeviceSession() {
  if (cookielessDevice.session) states.delete(cookielessDevice.session.value);
  cookielessDevice.session = undefined;
}

/** Forgets every mock session state and the cookieless device (tests). */
export function resetMockCarts() {
  selectMockScenario(null);
  nextToken = 1;
  states.clear();
  attemptsById.clear();
  nextId = 1;
  cookielessDevice = { enabled: false, session: undefined };
  orders.clear();
  grants.clear();
  endedSessions.clear();
  nextEvent = 1;
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
    if (!value.startsWith(MARKER) || endedSessions.has(value)) return undefined;
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

function cartLocked() {
  return conflict('cart_locked', "Your order is being paid, so it can't be changed right now.");
}

function orderAlreadyPlaced() {
  return conflict('order_already_placed', 'Your order has already been placed.');
}

/** After payment (S5): the placed order, or a paid-not-placed lock. */
function lockedAfterPayment(state: MockState): Response | null {
  if (state.placement?.status === 'placed') return orderAlreadyPlaced();
  if (state.placement?.status === 'paid_not_placed' || state.paying) return cartLocked();
  return null;
}

/**
 * The backend's confirmation of a verified success (S5): Paid, then Placed with
 * the next daily token, or paid-not-placed when a dish became unavailable.
 */
function confirmSuccess(state: MockState, attempt: MockAttempt, scenario: MockScenario) {
  if (attempt.status !== 'awaiting_payment') return;
  attempt.status = 'paid';
  state.paying = false;
  const unavailable = state.lines.some((line) => !isAvailable(line.itemId, scenario));
  state.placement =
    scenario === 'paid_not_placed' || unavailable
      ? { status: 'paid_not_placed' }
      : {
          status: 'placed',
          orderId: orderRef(nextId++),
          tokenNumber: String(nextToken++),
          placedAt: new Date().toISOString(),
        };
  const placement = state.placement;
  if (placement.status === 'placed' && state.checkout) {
    const sessionValue = [...states.entries()].find(([, value]) => value === state)?.[0] ?? null;
    orders.set(placement.orderId, {
      id: placement.orderId,
      qr: sessionValue?.slice(MARKER.length).split('.')[0] ?? '',
      tableNumber: state.checkout.data.table.number,
      tokenNumber: placement.tokenNumber,
      placedAt: placement.placedAt,
      status: 'placed',
      history: [{ state: 'placed', occurred_at: placement.placedAt }],
      checkout: state.checkout.data,
      sessionValue,
      secret: `mockLinkSecret${placement.orderId.slice(-4)}`,
      linkExpired: false,
    });
  }
}

/** The checkout as `GET /customer/checkout` returns it: with the payment summary once started. */
function checkoutView(state: MockState) {
  if (!state.checkout) return null;
  if (!state.paying && !state.placement) return state.checkout;
  const placement = state.placement;
  return {
    data: {
      ...state.checkout.data,
      status: placement?.status ?? ('payment_started' as const),
      payment: buildPaymentSummary(state.attempts.map((attempt) => attempt.status)),
      ...(placement?.status === 'placed'
        ? {
            order: {
              order_ref: placement.orderId,
              token_number: placement.tokenNumber,
              placed_at: placement.placedAt,
            },
          }
        : {}),
    },
  };
}

function paymentState(state: MockState, status: string) {
  return {
    data: {
      checkout_id: state.checkout?.data.checkout_id ?? '',
      status,
      payment: buildPaymentSummary(state.attempts.map((attempt) => attempt.status)),
    },
  };
}

/** A cart write: needs a session, and the `cart_rate_limited` scenario refuses it. */
function writeGuard(request: Request): MockSession | Response {
  const session = currentSession(request);
  if (!session) return sessionExpired();
  const locked = lockedAfterPayment(stateOf(session));
  if (locked) return locked;
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
    const placement = current ? stateOf(current).placement : null;
    const stage =
      placement?.status === 'placed'
        ? 'placed'
        : placement?.status === 'paid_not_placed'
          ? 'payment_issue'
          : current && stateOf(current).paying
            ? 'payment'
            : 'cart';
    const orderRef = placement?.status === 'placed' ? placement.orderId : null;
    return HttpResponse.json(buildEnteredSession(table.number, undefined, stage, orderRef), {
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
    const locked = lockedAfterPayment(stateOf(session));
    if (locked) return locked;
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
    const checkout = checkoutView(stateOf(session));
    return checkout ? HttpResponse.json(checkout, { headers: NO_STORE }) : notFound();
  }),

  http.post('*/customer/checkout/review', ({ request }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const scenario = resolveMockScenario(request);
    const state = stateOf(session);
    const locked = lockedAfterPayment(state);
    if (locked) return locked;
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

  http.post('*/customer/checkout/:checkoutId/payments', ({ request, params }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const scenario = resolveMockScenario(request);
    const state = stateOf(session);
    if (!state.checkout || state.checkout.data.checkout_id !== params.checkoutId) return notFound();
    if (state.placement?.status === 'placed') return orderAlreadyPlaced();
    if (state.placement?.status === 'paid_not_placed') return cartLocked();
    const unavailable = [
      ...new Set(
        state.lines.filter((line) => !isAvailable(line.itemId, scenario)).map((l) => l.itemId),
      ),
    ];
    const refused = (reasons: string[], ids: string[] = []) =>
      conflict('checkout_revalidation_required', 'Your order changed.', {
        unavailable_item_ids: ids,
        reasons,
      });

    if (!state.paying) {
      // First initiation: the price-lock checks (§11); any difference supersedes.
      const reasons = [
        ...(scenario === 'table_inactive' ? ['table_unavailable'] : []),
        ...(unavailable.length > 0 ? ['item_unavailable'] : []),
        ...(scenario === 'price_changed' ? ['price_changed'] : []),
        ...(scenario === 'tax_changed' ? ['tax_changed'] : []),
      ];
      if (reasons.length > 0) {
        state.checkout = null;
        return refused(reasons, unavailable);
      }
      if (scenario === 'payment_config_missing') {
        return conflict(
          'restaurant_configuration_incomplete',
          "This restaurant can't take orders.",
          {
            missing: ['payment'],
          },
        );
      }
      state.paying = true;
    } else {
      const awaiting = state.attempts.find((attempt) => attempt.status === 'awaiting_payment');
      if (awaiting) {
        if (scenario === 'still_confirming' || !awaiting.redirectUrl) {
          return conflict('payment_still_confirming', 'Still confirming.');
        }
        return HttpResponse.json(
          { data: { redirect_url: awaiting.redirectUrl } },
          { headers: NO_STORE },
        );
      }
      if (state.attempts.length >= MAX_ATTEMPTS) {
        return conflict('payment_retry_limit', "This order can't be paid again.");
      }
      // A retry re-checks availability only, and changes nothing when refused.
      if (unavailable.length > 0) return refused(['item_unavailable'], unavailable);
    }

    const id = `attempt-${nextId++}`;
    const appOrigin = request.headers.get('origin') ?? 'http://localhost';
    const attempt: MockAttempt = {
      id,
      status: 'awaiting_payment',
      outcome: null,
      redirectUrl: null,
      returnUrl: `${appOrigin}/t/${session.qr}/payment/return?checkout=${state.checkout.data.checkout_id}`,
    };
    state.attempts.push(attempt);
    attemptsById.set(id, attempt);
    if (scenario === 'gateway_error') {
      attempt.status = 'failed';
      return errorResponse(502, 'payment_gateway_unavailable', "We couldn't start the payment.");
    }
    attempt.redirectUrl = `${new URL(request.url).origin}/mock-gateway/${id}`;
    return HttpResponse.json(
      { data: { redirect_url: attempt.redirectUrl } },
      { headers: NO_STORE },
    );
  }),

  http.get('*/customer/checkout/:checkoutId/status', ({ request, params }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const state = stateOf(session);
    if (!state.checkout || state.checkout.data.checkout_id !== params.checkoutId) return notFound();
    const awaiting = state.attempts.find((attempt) => attempt.status === 'awaiting_payment');
    if (awaiting) {
      // The backend's server-side status query (S5: a success is confirmed).
      const scenario = resolveMockScenario(request);
      const outcome = awaiting.outcome;
      if (scenario === 'attempt_failed') awaiting.status = 'failed';
      else if (scenario === 'still_confirming' || outcome === null) {
        // nothing to learn yet
      } else if (outcome === 'success') {
        confirmSuccess(state, awaiting, scenario); // the missed webhook, recovered
      } else {
        awaiting.status = outcome;
      }
    }
    const status = state.placement?.status ?? (state.paying ? 'payment_started' : 'open');
    return HttpResponse.json(paymentState(state, status), {
      headers: NO_STORE,
    });
  }),

  http.post('*/customer/checkout/:checkoutId/release', ({ request, params }) => {
    const session = currentSession(request);
    if (!session) return sessionExpired();
    const state = stateOf(session);
    if (!state.checkout || state.checkout.data.checkout_id !== params.checkoutId) return notFound();
    if (!state.paying || state.placement) {
      return conflict('conflict', 'This order has no payment to cancel.');
    }
    if (state.attempts.some((attempt) => attempt.status === 'awaiting_payment')) {
      return conflict('payment_still_confirming', 'Still confirming.');
    }
    const released = paymentState(state, 'released');
    state.paying = false;
    state.checkout = null;
    state.attempts = [];
    return HttpResponse.json(released, { headers: NO_STORE });
  }),

  // The mock gateway page (the stand-in's role, for the mock API).
  http.get('*/mock-gateway/:attemptId', ({ params }) => {
    const attempt = attemptsById.get(String(params.attemptId));
    if (!attempt) return notFound();
    const buttons = [
      ['pay', 'Pay successfully'],
      ['pay_no_webhook', 'Pay, no webhook'],
      ['fail', 'Fail'],
      ['cancel', 'Cancel'],
      ['pending', 'Leave pending'],
    ]
      .map(
        ([value, label]) =>
          `<button type="submit" name="action" value="${value}">${label}</button>`,
      )
      .join('');
    return new HttpResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock payment</title></head>` +
        `<body><main><h1>Mock payment</h1><form method="post">${buttons}</form></main></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } },
    );
  }),

  http.post('*/mock-gateway/:attemptId', async ({ request, params }) => {
    const attempt = attemptsById.get(String(params.attemptId));
    if (!attempt) return notFound();
    const action = new URLSearchParams(await request.text()).get('action');
    if (action === 'pay' || action === 'pay_no_webhook') attempt.outcome = 'success';
    if (action === 'pay') {
      // The signed webhook, delivered before the customer returns (S5 P2).
      const owner = [...states.values()].find((state) => state.attempts.includes(attempt));
      if (owner) confirmSuccess(owner, attempt, resolveMockScenario(request));
    }
    if (action === 'fail') attempt.outcome = 'failed';
    else if (action === 'cancel') attempt.outcome = 'abandoned';
    return new HttpResponse(null, { status: 303, headers: { Location: attempt.returnUrl } });
  }),

  // S6: redeem an SMS link's secret for an order-access grant.
  http.post('*/customer/order-access', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      order_ref?: unknown;
      secret?: unknown;
    } | null;
    const order = typeof body?.order_ref === 'string' ? orders.get(body.order_ref) : undefined;
    if (!order || order.linkExpired || body?.secret !== order.secret) return notFound();
    const value = `${GRANT_MARKER}${nextId++}`;
    grants.set(value, order.id);
    if (cookielessDevice.enabled) cookielessDevice.grant = value;
    return HttpResponse.json(
      { data: { order_ref: order.id } },
      {
        headers: cookielessDevice.enabled
          ? NO_STORE
          : {
              'Set-Cookie': `${GRANT_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`,
              ...NO_STORE,
            },
      },
    );
  }),

  // S6: the order, for its placing session (until Completed) or a grant; else one 404.
  http.get('*/customer/orders/:orderRef', ({ request, params }) => {
    const ref = String(params.orderRef);
    const cookies = request.headers.get('cookie');
    const order =
      sessionOrder(currentSession(request))?.id === ref
        ? orders.get(ref)
        : grantedOrder(cookies)?.id === ref
          ? orders.get(ref)
          : undefined;
    if (!order) return notFound();
    return HttpResponse.json(orderResponse(order), { headers: NO_STORE });
  }),

  // Mock-only controls (never part of the backend contract): staff and SMS stand-ins.
  http.post('*/mock-control/orders/:orderRef/advance', ({ params }) => {
    const status = advanceMockOrder(String(params.orderRef));
    return status ? HttpResponse.json({ status }) : notFound();
  }),
  http.get('*/mock-control/orders/:orderRef/link', ({ params }) => {
    const link = mockOrderLink(String(params.orderRef));
    return link ? HttpResponse.json({ link }) : notFound();
  }),
  http.post('*/mock-control/orders/:orderRef/expire', ({ params }) =>
    expireMockOrderLink(String(params.orderRef))
      ? new HttpResponse(null, { status: 204 })
      : notFound(),
  ),
];
