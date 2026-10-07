import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { localDatabaseAvailable, paidNotPlacedRecord, setDishAvailable } from './local-database';

/**
 * Verified payment → order placement (F-01 S5) against the real local FastAPI
 * (playwright.backend.config.ts) with the stand-in gateway
 * (`STEWARD_PAYMENT_GATEWAY=stand_in`, `STEWARD_CUSTOMER_APP_URL=http://localhost:3320`)
 * and a `seed_ordering` database (500 bp tax, stand-in payment configuration).
 *
 * - Journey A: the stand-in's "Pay successfully" delivers a signed webhook: Paid →
 *   Placed before the customer returns, who goes on to the order page (S6).
 * - Journey B: "Pay, no webhook": the backend finds the success by a status query
 *   once the attempt is 15 seconds old (F1-35).
 * - Journey C: a dish becomes unavailable before the webhook: Paid, paid not
 *   placed, a payment issue, and no order, token or SMS (F1-22).
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const API = process.env.E2E_API_BASE_URL;
const MENU = `/t/${QR}`;
const RETURN = new RegExp(`${MENU}/payment/return\\?checkout=[0-9a-f-]{36}$`);
const ORDER_PAGE = new RegExp(`${MENU}/orders/[0-9a-f-]{36}$`);
const APP_ORIGIN = 'http://localhost:3320';
const RECOVERY_TIMEOUT = 45_000; // status queries start at 15 s; polling backs off to 30 s

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');
test.setTimeout(120_000);

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

async function toStandIn(page: Page) {
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  await expect(page.getByText('Amount: ₹525.00')).toBeVisible();
}

async function choose(page: Page, choice: 'Pay successfully' | 'Pay, no webhook') {
  await page.getByRole('button', { name: choice, exact: true }).click();
}

async function checkout(page: Page) {
  return (await (await page.request.get(`${API}/customer/checkout`)).json()).data;
}

/** The order page (S6) after placement: the token, items and total the backend placed. */
async function expectPlacedOrderPage(page: Page) {
  await expect(page).toHaveURL(ORDER_PAGE);
  await expect(page.getByText('Table 1')).toBeVisible();
  const items = page.getByRole('region', { name: 'Items' });
  await expect(items).toContainText('2 × Dal Makhani');
  await expect(items).toContainText('1 × Masala Chaas');
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total paid₹525.00');
  const current = await checkout(page);
  expect(current.status).toBe('placed');
  expect(current.order.token_number).toMatch(/^[1-9][0-9]*$/);
  expect(page.url()).toContain(`/orders/${current.order.order_ref}`);
  await expect(page.getByLabel(`Token ${current.order.token_number}`)).toBeVisible();
  expect(current.payment.latest_attempt).toEqual({ status: 'paid' });
  expect(JSON.stringify(current)).not.toMatch(/#k=|secret|redirect|merchant/i);
  return current.order.token_number as string;
}

test('Journey A: Pay → stand-in "Pay successfully" → webhook → the order page with token', async ({
  page,
}) => {
  await reachReview(page);
  await toStandIn(page);
  await choose(page, 'Pay successfully');

  const token = await expectPlacedOrderPage(page);
  const orderUrl = page.url();
  await expectNoAxeViolations(page); // order placed

  // The session cannot order again; a same-table rescan resumes the order page.
  const again = await page.request.post(`${API}/customer/cart/lines`, {
    data: { menu_item_id: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    headers: { Origin: APP_ORIGIN },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe('order_already_placed');
  await page.goto(MENU);
  await expect(page).toHaveURL(orderUrl);
  await expect(page.getByLabel(`Token ${token}`)).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('Journey B: Pay → "Pay, no webhook" → polling → status-query recovery → the order page', async ({
  page,
}) => {
  await reachReview(page);
  await toStandIn(page);
  await choose(page, 'Pay, no webhook');

  await expect(page).toHaveURL(RETURN);
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  expect((await checkout(page)).status).toBe('payment_started');
  await expect(page).toHaveURL(ORDER_PAGE, { timeout: RECOVERY_TIMEOUT });
  await expectPlacedOrderPage(page);
});

test('Journey C: a dish unavailable before placement → paid not placed, no order/token/SMS', async ({
  page,
}) => {
  test.skip(
    !localDatabaseAvailable,
    'Needs E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME to change menu availability locally.',
  );
  await reachReview(page);
  await toStandIn(page);
  setDishAvailable(QR!, 'Masala Chaas', false);
  try {
    await choose(page, 'Pay successfully');
    await expect(page).toHaveURL(RETURN);

    await expect(
      page.getByRole('heading', { name: 'Payment received, but your order could not be placed' }),
    ).toBeVisible();
    await expect(page.getByText(/order placed/i)).toHaveCount(0);
    await expect(page.getByText(/token/i)).toHaveCount(0);
    await expectNoAxeViolations(page); // paid not placed
    const current = await checkout(page);
    expect(current.status).toBe('paid_not_placed');
    expect(current.order).toBeUndefined();
    expect(paidNotPlacedRecord(QR!)).toEqual({
      issueKinds: 'item_unavailable_at_placement',
      paidAttempts: 1,
      orders: 0,
      sms: 0,
    });
    await page.goto(`${MENU}/cart`);
    await expect(page).toHaveURL(new RegExp(`${MENU}/payment/return$`));
  } finally {
    setDishAvailable(QR!, 'Masala Chaas', true);
  }
});
