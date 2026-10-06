import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * Verified payment → order placement (F-01 S5) against the standalone mock API,
 * whose mock gateway page offers "Pay successfully" (the signed webhook places
 * the order before the customer returns) and "Pay, no webhook" (only a status
 * poll finds the success). The real backend is exercised by
 * `e2e/real-backend/customer-placement.spec.ts`.
 */

const MENU = `/t/${MOCK_QR.table1}`;
const RETURN = new RegExp(`${MENU}/payment/return(\\?.*)?$`);

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function setScenario(context: BrowserContext, scenario: string) {
  await context.addCookies([
    { name: 'mock_scenario', value: scenario, domain: 'localhost', path: '/' },
  ]);
}

async function reachReview(page: Page) {
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
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total₹525.00');
}

async function payWith(page: Page, choice: 'Pay successfully' | 'Pay, no webhook') {
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mock payment' })).toBeVisible();
  await page.getByRole('button', { name: choice, exact: true }).click();
  await expect(page).toHaveURL(RETURN);
}

function placed(page: Page) {
  return page.getByRole('status', { name: 'Order placed' });
}

test('Pay successfully → webhook → Order placed in place, with the token', async ({ page }) => {
  await reachReview(page);
  await payWith(page, 'Pay successfully');

  await expect(placed(page)).toBeVisible();
  await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();
  await expect(placed(page)).toContainText('Table 1');
  await expect(placed(page)).toContainText('2 × Dal Makhani');
  await expect(placed(page)).toContainText('Total paid₹525.00');
  await expect(page.locator('a[href*="/orders/"]')).toHaveCount(0);
  expect(page.url()).not.toContain('/orders/');
  await expectNoAxeViolations(page); // order placed
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('Pay, no webhook → polling recovers the success → Order placed', async ({ page }) => {
  await reachReview(page);
  await payWith(page, 'Pay, no webhook');
  await expect(placed(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/^Token \d+$/)).toBeVisible();
});

test('a placed session resumes its confirmation from any page and cannot order again', async ({
  page,
}) => {
  await reachReview(page);
  await payWith(page, 'Pay successfully');
  await expect(placed(page)).toBeVisible();
  const token = await page.getByLabel(/^Token \d+$/).textContent();
  for (const path of [MENU, `${MENU}/cart`, `${MENU}/details`, `${MENU}/checkout`]) {
    await page.goto(path);
    await expect(page).toHaveURL(RETURN);
    await expect(placed(page)).toBeVisible();
  }
  await expect(page.getByLabel(/^Token \d+$/)).toHaveText(token ?? '');
});

test('paid but not placed: the refund notice, no order and no token', async ({ page, context }) => {
  await reachReview(page);
  await setScenario(context, 'paid_not_placed');
  await payWith(page, 'Pay successfully');

  await expect(
    page.getByRole('heading', { name: 'Payment received, but your order could not be placed' }),
  ).toBeVisible();
  await expect(
    page.getByText('The restaurant will handle your refund.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/order placed/i)).toHaveCount(0);
  await expect(page.getByText(/token/i)).toHaveCount(0);
  await expectNoAxeViolations(page); // paid not placed

  await page.goto(`${MENU}/cart`);
  await expect(page).toHaveURL(RETURN); // a payment-issue session cannot start over
});
