import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Payment initiation and return (F-01 S4) against the real local FastAPI
 * (playwright.backend.config.ts) running with `STEWARD_PAYMENT_GATEWAY=stand_in`
 * and `STEWARD_CUSTOMER_APP_URL=http://localhost:3320`, on a database seeded with
 * `seed_ordering` (500 bp tax, stand-in payment configuration).
 *
 * The stand-in page (served by the backend) offers Fail, Cancel and Leave
 * pending, and cannot complete a payment: S4 never marks a payment Paid and
 * never places an order, so no journey here ends with an order. The backend
 * queries the stand-in once an attempt is 15 seconds old, so outcomes appear on
 * the return page after about 15 to 20 seconds of polling.
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const API = process.env.E2E_API_BASE_URL;
const MENU = `/t/${QR}`;
const RETURN = new RegExp(`${MENU}/payment/return\\?checkout=[0-9a-f-]{36}$`);
const APP_ORIGIN = 'http://localhost:3320';
// Status queries start at 15 s; polling backs off 2 s → 30 s.
const SETTLE_TIMEOUT = 45_000;

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');
test.setTimeout(150_000);

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

/** On the backend's stand-in page: check the amount, choose, return to the app. */
async function onStandIn(page: Page, choice: 'Fail' | 'Cancel' | 'Leave pending') {
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/^\/api\/v1\/dev\/stand-in-gateway\/payments\//);
  await expect(page.getByText('Amount: ₹525.00')).toBeVisible();
  await page.getByRole('button', { name: choice, exact: true }).click();
  await expect(page).toHaveURL(RETURN);
}

async function checkout(page: Page) {
  const response = await page.request.get(`${API}/customer/checkout`);
  return {
    status: response.status(),
    body: response.status() === 200 ? await response.json() : null,
  };
}

function neverPaid(page: Page) {
  return expect(page.getByText(/\bpaid\b|payment successful|order placed|token/i)).toHaveCount(0);
}

test('QR → review → Pay → stand-in Fail → return → polling → not completed → retry → Cancel → change order', async ({
  page,
}) => {
  await reachReview(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await onStandIn(page, 'Fail');

  // Back from the gateway: the page confirms with the backend, never with the URL.
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  await neverPaid(page);
  await expectNoAxeViolations(page); // confirming
  const started = await checkout(page);
  expect(started.body.data.status).toBe('payment_started');
  expect(started.body.data.payment.latest_attempt.status).toBe('awaiting_payment');
  expect(JSON.stringify(started.body)).not.toMatch(/stand-in|redirect|merchant/i);

  // The cart is locked while payment is in progress.
  const locked = await page.request.post(`${API}/customer/cart/lines`, {
    data: { menu_item_id: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    headers: { Origin: APP_ORIGIN },
  });
  expect(locked.status()).toBe(409);
  expect((await locked.json()).error.code).toBe('cart_locked');

  // About 15 s later the backend's status query learns the stand-in outcome.
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
    timeout: SETTLE_TIMEOUT,
  });
  await neverPaid(page);
  await expectNoAxeViolations(page); // not completed
  expect((await checkout(page)).body.data.payment).toEqual({
    latest_attempt: { status: 'failed' },
    attempts_made: 1,
    attempts_limit: 5,
  });

  // Retry: the same checkout and amount, a new attempt.
  await page.getByRole('button', { name: 'Retry payment' }).click();
  await onStandIn(page, 'Cancel');
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
    timeout: SETTLE_TIMEOUT,
  });
  const retried = (await checkout(page)).body.data;
  expect(retried.payment).toEqual({
    latest_attempt: { status: 'abandoned' },
    attempts_made: 2,
    attempts_limit: 5,
  });
  expect(retried.amounts.total.amount_minor).toBe(52500);

  // Review / change order: released, back to an editable cart with its lines.
  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart$`));
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toBeVisible();
  expect((await checkout(page)).status).toBe(404);
  await page.goto(`${MENU}/checkout`);
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.getByRole('button', { name: 'Pay', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('Leave pending stays unconfirmed; the customer can go back to the same payment', async ({
  page,
}) => {
  await reachReview(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  const firstPayment = page.url();
  await onStandIn(page, 'Leave pending');
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();

  // Changing the order waits for the unconfirmed attempt.
  await page.waitForTimeout(16_000); // old enough for the backend to ask the stand-in
  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(
    page.getByRole('heading', { name: 'Still confirming your previous payment…' }),
  ).toBeVisible();
  await expectNoAxeViolations(page); // still confirming
  await neverPaid(page);

  // A payment-stage session resumes at the payment page from anywhere.
  await page.goto(`${MENU}/cart`);
  await expect(page).toHaveURL(new RegExp(`${MENU}/payment/return$`));
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();

  // Going back returns the same stand-in payment (no new attempt), where it is cancelled.
  await page.getByRole('button', { name: 'Go back to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Stand-in payment' })).toBeVisible();
  expect(page.url()).toBe(firstPayment);
  await onStandIn(page, 'Cancel');
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
    timeout: SETTLE_TIMEOUT,
  });
  expect((await checkout(page)).body.data.payment.attempts_made).toBe(1);
  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart$`));
});
