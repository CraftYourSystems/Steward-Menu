/**
 * Cookie Playwright sets to choose a data scenario on the standalone mock API.
 * Scenarios only select fixtures; they never implement business rules.
 */
export const MOCK_SCENARIO_COOKIE = 'mock_scenario';

export const MOCK_SCENARIOS = [
  'default',
  /** Customer menu: the restaurant has no available items. */
  'empty',
  /** Customer menu: the backend fails with a 500. */
  'server_error',
  /** Customer cart (S2): Dal Makhani has become unavailable (hidden from the menu, refused by the cart). */
  'dal_unavailable',
  /** Customer cart (S2): every cart write is refused with 429 and `Retry-After: 30`. */
  'cart_rate_limited',
  /** Review (S3): the restaurant has no tax rate (`restaurant_configuration_incomplete`). */
  'tax_missing',
  /** Review (S3): the table was deactivated (`table_unavailable`). */
  'table_inactive',
  /** Pay (S4): the gateway cannot start the payment (502); the attempt fails. */
  'gateway_error',
  /** Payment return (S4): the next status poll reports the attempt failed. */
  'attempt_failed',
  /** Payment (S4): the attempt stays unconfirmed; Pay, retry and release answer `payment_still_confirming`. */
  'still_confirming',
  /** Pay (S4): a price changed since Review (`reasons: ["price_changed"]`). */
  'price_changed',
  /** Pay (S4): the tax rate changed since Review (`reasons: ["tax_changed"]`). */
  'tax_changed',
  /** Pay (S4): the restaurant has no payment configuration (`missing: ["payment"]`). */
  'payment_config_missing',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/*
 * Vitest has no cookie jar, so a test selects the scenario directly; it is reset
 * after every test (`resetMockCarts`). Playwright always uses the cookie.
 */
let selected: MockScenario | null = null;

export function selectMockScenario(scenario: MockScenario | null) {
  selected = scenario;
}

export function resolveMockScenario(request: Request): MockScenario {
  if (selected) return selected;
  const value = readCookie(request, MOCK_SCENARIO_COOKIE);
  return (MOCK_SCENARIOS as readonly string[]).includes(value ?? '')
    ? (value as MockScenario)
    : 'default';
}
