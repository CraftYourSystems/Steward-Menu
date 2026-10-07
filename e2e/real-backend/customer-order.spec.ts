import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { backendCliAvailable, EXIT, transitionOrder, type TransitionTarget } from './backend-cli';
import {
  expireOrderAccess,
  localDatabaseAvailable,
  mintOrderLink,
  orderLifecycleRecord,
  restaurantIdOf,
} from './local-database';

/**
 * Customer order access, live status and the minimal lifecycle (F-01 S6)
 * against the real local FastAPI (playwright.backend.config.ts) with the
 * stand-in gateway, its `/ws/customer` and a `seed_ordering` database (staff
 * KITCHEN1, SERVICE1, BILLING1). Kitchen and service staff act through the
 * backend's transition command (`backend-cli.ts`, F1-30).
 *
 * - Journey A: placement → the order page; a same-table rescan resumes it.
 * - Journey B: Cooking → Ready → Completed live, without reloading; Completed
 *   ends the session and a rescan starts afresh.
 * - Journey C: the connection drops; the change made meanwhile shows on reconnect.
 * - Journey D: the SMS link opens the order on another device, live.
 * - Journey E: a wrong, partial or expired link, or the reference alone: one
 *   generic answer.
 * - Journey F: the link's grant keeps reading the order after Completed.
 * - Journey G: the wrong department is refused (F-05 §6) and nothing changes.
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const API = process.env.E2E_API_BASE_URL;
const MENU = `/t/${QR}`;
const ORDER_PAGE = new RegExp(`${MENU}/orders/([0-9a-f-]{36})$`);
const LIVE_TIMEOUT = 15_000; // the outbox publisher polls every 2 s

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');
test.skip(
  !backendCliAvailable || !localDatabaseAvailable,
  'Needs E2E_BACKEND_DIR, E2E_BACKEND_DATABASE_URL, E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME.',
);
test.setTimeout(120_000);

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function expectFitsViewport(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** QR → cart → details → Review → Pay → "Pay successfully" → the order page. */
async function placeOrder(page: Page): Promise<string> {
  await page.goto(MENU);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const dish of ['Dal Makhani', 'Dal Makhani', 'Masala Chaas']) {
    const add = page.getByRole('button', { name: `Add ${dish}` });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(add).toBeEnabled();
  }
  await page.goto(`${MENU}/details`);
  await page.getByRole('textbox', { name: 'Name' }).fill('Asha Rao');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('98765 43210');
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await page.getByRole('button', { name: 'Review order' }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  await page.getByRole('button', { name: 'Pay successfully', exact: true }).click();
  await expect(page).toHaveURL(ORDER_PAGE);
  return ORDER_PAGE.exec(page.url())![1]!;
}

function staff(staffId: 'KITCHEN1' | 'SERVICE1' | 'BILLING1') {
  return { staffId, restaurantId: restaurantIdOf(QR!) };
}

/** Kitchen (Cooking, Ready) or service (Completed) staff move the order on. */
function move(orderRef: string, to: TransitionTarget) {
  const result = transitionOrder(orderRef, to, staff(to === 'completed' ? 'SERVICE1' : 'KITCHEN1'));
  expect(result.code, result.stderr).toBe(EXIT.moved);
}

function status(page: Page) {
  return page.getByRole('status', { name: 'Current status' });
}

async function anotherDevice(browser: Browser, page: Page): Promise<Page> {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: new URL(page.url()).origin,
  });
  return context.newPage();
}

test('Journey A: placement → the order page; a same-table rescan resumes it', async ({ page }) => {
  const ref = await placeOrder(page);
  await expect(status(page)).toContainText('Order received');
  await expect(page.getByText('Live updates on')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Items' })).toContainText('2 × Dal Makhani');
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total paid₹525.00');
  await expect(page.locator('body')).not.toContainText(/Asha|98765/);
  await expectNoAxeViolations(page); // placed
  await expectFitsViewport(page);

  for (const path of [MENU, `${MENU}/cart`]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${MENU}/orders/${ref}$`));
  }
  const view = await page.request.get(`${API}/customer/orders/${ref}`);
  expect(view.status()).toBe(200);
  expect(JSON.stringify(await view.json())).not.toMatch(/Asha|9876543210|secret|hash/i);
});

test('Journey B: Cooking → Ready → Completed live; Completed ends the session', async ({
  page,
}) => {
  const ref = await placeOrder(page);
  await expect(page.getByText('Live updates on')).toBeVisible();

  move(ref, 'cooking');
  await expect(status(page)).toContainText('Being prepared', { timeout: LIVE_TIMEOUT });
  await expectNoAxeViolations(page); // cooking
  move(ref, 'ready_to_serve');
  await expect(status(page)).toContainText('Ready', { timeout: LIVE_TIMEOUT });
  await expectNoAxeViolations(page); // ready to serve
  move(ref, 'completed');
  await expect(status(page)).toContainText('Completed', { timeout: LIVE_TIMEOUT });
  await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();
  await expect(page.getByText('Live updates on')).toHaveCount(0);
  await expectNoAxeViolations(page); // completed
  await expectFitsViewport(page);

  expect(orderLifecycleRecord(ref)).toEqual({
    status: 'completed',
    history: 'placed,cooking,ready_to_serve,completed',
    statusSms: 3,
    sessionEndReason: 'order_completed',
  });
  // The session ended: its order read is refused, and a rescan starts afresh.
  expect((await page.request.get(`${API}/customer/orders/${ref}`)).status()).toBe(404);
  await page.goto(MENU);
  await expect(page).toHaveURL(new RegExp(`${MENU}$`));
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeEnabled();
});

test('Journey C: a change made while disconnected shows on reconnect', async ({ page }) => {
  // The test stands between the page and /ws/customer: it can drop the connection
  // and refuse reconnects, like a network outage the page cannot see coming.
  let connected: WebSocketRoute | null = null;
  let outage = false;
  await page.routeWebSocket(/\/ws\/customer$/, (ws) => {
    if (outage) {
      void ws.close({ code: 1011 });
      return;
    }
    ws.connectToServer();
    connected = ws;
  });
  const ref = await placeOrder(page);
  await expect(page.getByText('Live updates on')).toBeVisible();

  outage = true;
  await (connected as WebSocketRoute | null)?.close({ code: 1001 });
  await expect(page.getByText('Reconnecting…')).toBeVisible();
  move(ref, 'cooking');
  await page.waitForTimeout(3_000); // the event is published with nobody listening
  await expect(status(page)).toContainText('Order received'); // nothing told the page yet
  outage = false;
  await expect(status(page)).toContainText('Being prepared', { timeout: LIVE_TIMEOUT });
  await expect(page.getByText('Live updates on')).toBeVisible();
});

test('Journey D: the SMS link opens the order on another device, live', async ({
  page,
  browser,
}) => {
  const ref = await placeOrder(page);
  const secret = mintOrderLink(ref);
  const phone = await anotherDevice(browser, page);
  await phone.goto(`${MENU}/orders/${ref}#k=${secret}`);

  await expect(phone.getByLabel(/^Token \d+$/)).toBeVisible();
  expect(phone.url()).not.toContain(secret);
  expect(new URL(phone.url()).hash).toBe('');
  const cookies = await phone.context().cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual(['steward_order_access']);
  expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(cookies[0]!.value).not.toBe(secret);
  await expectNoAxeViolations(phone);

  move(ref, 'cooking');
  await expect(status(phone)).toContainText('Being prepared', { timeout: LIVE_TIMEOUT });
  await expect(status(page)).toContainText('Being prepared', { timeout: LIVE_TIMEOUT });
  expect(await phone.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await phone.context().close();
});

test('Journey E: a wrong, partial or expired link, or the reference alone: one answer', async ({
  page,
  browser,
}) => {
  const ref = await placeOrder(page);
  const secret = mintOrderLink(ref);
  const phone = await anotherDevice(browser, page);
  const unavailable = phone.getByRole('heading', { name: "This order link isn't available" });

  for (const fragment of ['', `#k=${secret.slice(0, -1)}`, '#k=wrong']) {
    await phone.goto(`${MENU}/orders/${ref}${fragment}`);
    await expect(unavailable).toBeVisible();
    expect(new URL(phone.url()).hash).toBe('');
  }
  await expectNoAxeViolations(phone);
  await expectFitsViewport(phone);
  expireOrderAccess(ref);
  await phone.goto(`${MENU}/orders/${ref}#k=${secret}`);
  await expect(unavailable).toBeVisible();
  await phone.context().close();
});

test('Journey F: the link keeps reading the order after Completed', async ({ page, browser }) => {
  const ref = await placeOrder(page);
  const phone = await anotherDevice(browser, page);
  await phone.goto(`${MENU}/orders/${ref}#k=${mintOrderLink(ref)}`);
  await expect(phone.getByLabel(/^Token \d+$/)).toBeVisible();
  for (const to of ['cooking', 'ready_to_serve', 'completed'] as const) move(ref, to);
  await expect(status(phone)).toContainText('Completed', { timeout: LIVE_TIMEOUT });
  await phone.reload(); // the grant, unlike the session, still reads the order
  await expect(status(phone)).toContainText('Completed');
  await expect(phone.getByRole('list', { name: 'Progress' })).toContainText('Ready (done)');
  await phone.context().close();
});

test('Journey G: the wrong department is refused and nothing changes', async ({ page }) => {
  const ref = await placeOrder(page);
  const refused = [
    transitionOrder(ref, 'cooking', staff('BILLING1')),
    transitionOrder(ref, 'cooking', staff('SERVICE1')),
  ];
  expect(refused.map((r) => r.code)).toEqual([EXIT.notAuthorized, EXIT.notAuthorized]);
  expect(transitionOrder(ref, 'ready_to_serve', staff('KITCHEN1')).code).toBe(
    EXIT.invalidTransition,
  );
  move(ref, 'cooking');
  move(ref, 'ready_to_serve');
  expect(transitionOrder(ref, 'completed', staff('KITCHEN1')).code).toBe(EXIT.notAuthorized);
  await expect(status(page)).toContainText('Ready', { timeout: LIVE_TIMEOUT });
  expect(orderLifecycleRecord(ref).history).toBe('placed,cooking,ready_to_serve');
  expect(
    transitionOrder('00000000-0000-4000-8000-000000000000', 'cooking', staff('KITCHEN1')).code,
  ).toBe(EXIT.notFound);
});
