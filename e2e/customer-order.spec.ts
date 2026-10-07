import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * The customer's order page and live status (F-01 S6) against the standalone
 * mock API and its `/ws/customer`. The mock-only control routes stand in for
 * kitchen and service staff (F-05's transition service) and for the SMS; the
 * real backend is exercised by `e2e/real-backend/customer-order.spec.ts`.
 */

const MOCK_API = `http://localhost:${process.env.E2E_MOCK_API_PORT ?? 8788}`;
const MENU = `/t/${MOCK_QR.table1}`;
const ORDER_PAGE = new RegExp(`${MENU}/orders/([0-9a-f-]{36})$`);

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

/** QR → cart → details → Review → Pay successfully → the order page. Returns its ref. */
async function placeOrder(page: Page): Promise<string> {
  await page.goto(MENU);
  await expect(page.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME })).toBeVisible();
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
  await page.getByRole('button', { name: 'Pay successfully', exact: true }).click();
  await expect(page).toHaveURL(ORDER_PAGE);
  return ORDER_PAGE.exec(page.url())![1]!;
}

/** A kitchen or service member moves the order on (the mock's F-05 stand-in). */
async function advance(page: Page, orderRef: string) {
  const response = await page.request.post(`${MOCK_API}/mock-control/orders/${orderRef}/advance`);
  expect(response.ok()).toBe(true);
}

async function smsLink(page: Page, orderRef: string): Promise<string> {
  const response = await page.request.get(`${MOCK_API}/mock-control/orders/${orderRef}/link`);
  return ((await response.json()) as { link: string }).link;
}

function status(page: Page) {
  return page.getByRole('status', { name: 'Current status' });
}

/** Another phone: a fresh browser context with no cookies. */
async function anotherDevice(browser: Browser, page: Page): Promise<Page> {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: new URL(page.url()).origin,
  });
  return context.newPage();
}

test('live status: Placed → Cooking → Ready → Completed, without reloading', async ({ page }) => {
  const ref = await placeOrder(page);
  await expect(status(page)).toContainText('Order received');
  await expect(page.getByText('Live updates on')).toBeVisible();
  await expectNoAxeViolations(page); // placed
  await expectFitsViewport(page);

  await advance(page, ref);
  await expect(status(page)).toContainText('Being prepared');
  await expectNoAxeViolations(page); // cooking
  await advance(page, ref);
  await expect(status(page)).toContainText('Ready');
  await expectNoAxeViolations(page); // ready to serve
  await advance(page, ref);
  await expect(status(page)).toContainText('Completed');
  await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();
  await expect(page.getByText('Live updates on')).toHaveCount(0);
  await expectNoAxeViolations(page); // completed
  await expectFitsViewport(page);

  // Completed ended the session (F1-37): a rescan of the same table starts afresh.
  await page.goto(MENU);
  await expect(page).toHaveURL(new RegExp(`${MENU}$`));
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeVisible();
});

test('a reload resyncs: the page shows the status the API reports', async ({ page }) => {
  const ref = await placeOrder(page);
  await advance(page, ref);
  await page.reload();
  await expect(status(page)).toContainText('Being prepared');
});

test('the SMS link opens the order on another device and strips the secret', async ({
  page,
  browser,
}) => {
  const ref = await placeOrder(page);
  const link = await smsLink(page, ref);
  const phone = await anotherDevice(browser, page);
  const secret = link.slice(link.indexOf('#k=') + 3);

  await phone.goto(link);
  await expect(phone.getByLabel(/^Token \d+$/)).toBeVisible();
  expect(phone.url()).not.toContain(secret);
  expect(new URL(phone.url()).hash).toBe('');
  await expect(status(phone)).toContainText('Order received');

  await advance(page, ref);
  await expect(status(phone)).toContainText('Being prepared'); // live on the other device too
  await expectNoAxeViolations(phone);
  expect(await phone.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await phone.context().close();
});

test('a wrong, expired or missing link shows one generic answer', async ({ page, browser }) => {
  const ref = await placeOrder(page);
  const link = await smsLink(page, ref);
  const phone = await anotherDevice(browser, page);
  const unavailable = phone.getByRole('heading', { name: "This order link isn't available" });

  await phone.goto(link.replace(/#k=.*/, '#k=wrongSecretValue'));
  await expect(unavailable).toBeVisible();
  await expectNoAxeViolations(phone);
  await phone.goto(link.replace(/#k=.*/, '')); // the reference alone grants nothing
  await expect(unavailable).toBeVisible();
  await page.request.post(`${MOCK_API}/mock-control/orders/${ref}/expire`);
  await phone.goto(link);
  await expect(unavailable).toBeVisible();
  await expectFitsViewport(phone);
  await phone.context().close();
});
