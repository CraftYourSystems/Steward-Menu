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

export function resolveMockScenario(request: Request): MockScenario {
  const value = readCookie(request, MOCK_SCENARIO_COOKIE);
  return (MOCK_SCENARIOS as readonly string[]).includes(value ?? '')
    ? (value as MockScenario)
    : 'default';
}
