import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { localDatabaseAvailable, sessionPaymentRecord, setTableActive } from './local-database';

/**
 * F-01 S7 against the real local FastAPI with the stand-in gateway
 * (playwright.backend.config.ts):
 *
 * - Journey A: Fail → Retry payment → Pay successfully → the order page (F1-33).
 * - Journey B: Fail → Review / change order → Review → Pay → Pay successfully →
 *   the order page (F1-33).
 * - Journey C: `order.placed` in realtime (DoD 16): the order is placed while the
 *   customer waits on the return page, between two polls far apart; the socket
 *   carries `order.placed` and the page goes on at once.
 * - Journey D: with the socket unavailable, polling still finds the placement.
 * - Journey E: a table deactivated after placement still resumes the order on a
 *   same-table rescan (F1-32, F1-36); a new customer there is refused.
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const API = process.env.E2E_API_BASE_URL;
const MENU = `/t/${QR}`;
const RETURN = new RegExp(`${MENU}/payment/return\\?checkout=[0-9a-f-]{36}$`);
const ORDER_PAGE = new RegExp(`${MENU}/orders/([0-9a-f-]{36})$`);
// The backend asks the stand-in once an attempt is 15 s old; polling backs off to 30 s.
const SETTLE_TIMEOUT = 45_000;

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');
test.skip(
  !localDatabaseAvailable,
  'Needs E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME to read back payments.',
);
test.setTimeout(180_000);

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

/** QR → menu → cart → details → review: ₹525.00 (2 × 220.00 + 60.00, 5 % tax). */
async function reachReview(page: Page) {
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
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total₹525.00');
}

type Choice = 'Pay successfully' | 'Fail' | 'Leave pending';

/** On the stand-in page: choose. Returns the stand-in page's URL. */
async function onStandIn(page: Page, choice: Choice): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  await expect(page.getByText('Amount: ₹525.00')).toBeVisible();
  const standIn = page.url();
  await page.getByRole('button', { name: choice, exact: true }).click();
  return standIn;
}

async function pay(page: Page, choice: Choice): Promise<string> {
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  return onStandIn(page, choice);
}

async function failed(page: Page) {
  await expect(page).toHaveURL(RETURN);
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
    timeout: SETTLE_TIMEOUT,
  });
}

async function orderPage(page: Page, timeout?: number): Promise<string> {
  await expect(page).toHaveURL(ORDER_PAGE, { timeout });
  await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total paid₹525.00');
  return ORDER_PAGE.exec(page.url())![1]!;
}

test('Journey A: Fail → Retry payment → Pay successfully → the order page', async ({ page }) => {
  await reachReview(page);
  await pay(page, 'Fail');
  await failed(page);

  await page.getByRole('button', { name: 'Retry payment' }).click();
  await onStandIn(page, 'Pay successfully');
  const ref = await orderPage(page);
  await expectNoAxeViolations(page);

  // One checkout, its failed attempt untouched, then the Paid one; one order, no issue.
  expect(sessionPaymentRecord(ref)).toEqual({
    attempts: 'placed:failed,placed:paid',
    orders: 1,
    issues: 0,
  });
  await page.goto(MENU); // the session cannot order again: it resumes its order
  await expect(page).toHaveURL(new RegExp(`${MENU}/orders/${ref}$`));
});

test('Journey B: Fail → Review / change order → Review → Pay → the order page', async ({
  page,
}) => {
  await reachReview(page);
  await pay(page, 'Fail');
  await failed(page);

  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart$`));
  await page.goto(`${MENU}/checkout`);
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total₹525.00');
  await pay(page, 'Pay successfully');
  const ref = await orderPage(page);

  // The released checkout keeps its failed attempt; the new one was paid and placed.
  expect(sessionPaymentRecord(ref)).toEqual({
    attempts: 'released:failed,placed:paid',
    orders: 1,
    issues: 0,
  });
});

test('Journey C: order.placed arrives in realtime and the page goes on at once', async ({
  page,
}) => {
  const frames: string[] = [];
  page.on('websocket', (socket) => {
    if (socket.url().endsWith('/ws/customer')) {
      socket.on('framereceived', ({ payload }) => frames.push(String(payload)));
    }
  });
  let polls = 0;
  page.on('request', (request) => {
    if (/\/customer\/checkout\/[0-9a-f-]{36}\/status$/.test(request.url())) polls += 1;
  });

  await reachReview(page);
  const standIn = await pay(page, 'Leave pending');
  await expect(page).toHaveURL(RETURN);
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();

  // Polls back off 2 s, 3 s, 4.5 s, 6.75 s, 10.1 s, 15.2 s: once five status reads
  // have happened (the socket's resync may be one of them), the next scheduled poll
  // is at least 10 seconds away.
  await expect.poll(() => polls, { timeout: 40_000 }).toBeGreaterThanOrEqual(5);
  const before = polls;
  // The gateway confirms now (the stand-in's signed webhook): Paid → Placed.
  const confirmed = await page.request.post(standIn, {
    form: { action: 'pay' },
    maxRedirects: 0,
  });
  expect(confirmed.status()).toBe(303);

  const ref = await orderPage(page, 6_000); // far sooner than the next poll
  const placed = frames.map((frame) => JSON.parse(frame)).find((e) => e.type === 'order.placed');
  expect(placed).toMatchObject({ type: 'order.placed', order_id: ref });
  expect(polls - before).toBeLessThanOrEqual(2); // the event's own status read
  expect(sessionPaymentRecord(ref)).toEqual({ attempts: 'placed:paid', orders: 1, issues: 0 });
});

test('Journey D: with the socket down, polling still finds the placement', async ({ page }) => {
  // Every customer socket is refused, like a proxy that drops WebSocket upgrades.
  await page.routeWebSocket(/\/ws\/customer$/, (socket) => void socket.close({ code: 1011 }));
  await reachReview(page);
  const standIn = await pay(page, 'Leave pending');
  await expect(page).toHaveURL(RETURN);
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  await page.request.post(standIn, { form: { action: 'pay' }, maxRedirects: 0 });
  const ref = await orderPage(page, SETTLE_TIMEOUT);
  expect(sessionPaymentRecord(ref).orders).toBe(1);
});

test('Journey E: after deactivation the placed session resumes; a newcomer is refused', async ({
  page,
  browser,
}) => {
  await reachReview(page);
  await pay(page, 'Pay successfully');
  const ref = await orderPage(page);
  setTableActive(QR!, false);
  try {
    await page.goto(MENU); // the same-table rescan
    await expect(page).toHaveURL(new RegExp(`${MENU}/orders/${ref}$`));
    await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();

    const newcomer = await (
      await browser.newContext({ baseURL: new URL(page.url()).origin })
    ).newPage();
    await newcomer.goto(MENU);
    await expect(
      newcomer.getByRole('heading', { level: 1, name: 'Table unavailable' }),
    ).toBeVisible();
    expect((await newcomer.context().cookies()).map((c) => c.name)).not.toContain(
      'steward_customer_session',
    );
    await newcomer.context().close();
    expect((await page.request.get(`${API}/customer/orders/${ref}`)).status()).toBe(200);
  } finally {
    setTableActive(QR!, true);
  }
});
