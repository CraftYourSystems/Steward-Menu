import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * Payment initiation and the payment return page (F-01 S4) against the
 * standalone mock API, which mirrors the backend's payment rules and serves a
 * mock gateway page (Fail, Cancel, Leave pending). The real backend and its
 * stand-in gateway are exercised by `e2e/real-backend/customer-payment.spec.ts`.
 * S4 never places an order: no journey here ends paid.
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

function alertWith(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/** QR → menu → cart → details → review. */
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

/** Pay, then choose an outcome on the mock gateway page; back on the return page. */
async function payAndChoose(page: Page, choice: 'Fail' | 'Cancel' | 'Leave pending') {
  await page.getByRole('button', { name: /^(Pay|Retry payment|Go back to payment)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Mock payment' })).toBeVisible();
  await page.getByRole('button', { name: choice }).click();
  await expect(page).toHaveURL(RETURN);
}

function notPaid(page: Page) {
  return expect(page.getByText(/\bpaid\b|payment successful|order placed/i)).toHaveCount(0);
}

test('Pay → gateway → Fail → not completed → Retry → Cancel → Review / change order', async ({
  page,
}) => {
  await reachReview(page);
  await expectNoAxeViolations(page); // review with Pay

  await payAndChoose(page, 'Fail');
  // The return alone proves nothing: the page confirms with the backend first.
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Payment not completed' })).toContainText(
    '₹525.00',
  );
  await notPaid(page);
  await expectNoAxeViolations(page); // not completed

  await payAndChoose(page, 'Cancel'); // a retry: the same checkout, a new attempt
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible();

  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart$`));
  const dal = page.getByRole('listitem', { name: 'Dal Makhani' });
  await expect(dal).toBeVisible();
  // The cart is editable again.
  await dal.getByRole('button', { name: /increase/i }).click();
  await expect(dal).toContainText('3');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('Leave pending keeps confirming; changing the order waits for it', async ({ page }) => {
  await reachReview(page);
  await payAndChoose(page, 'Leave pending');
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  await expectNoAxeViolations(page); // confirming
  await notPaid(page);

  await page.getByRole('button', { name: 'Review / change order' }).click();
  await expect(
    page.getByRole('heading', { name: 'Still confirming your previous payment…' }),
  ).toBeVisible();
  await expectNoAxeViolations(page); // still confirming

  // Back to the same gateway page, then cancel there.
  await payAndChoose(page, 'Cancel');
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible();
});

test('a payment in progress resumes at the payment page; the cart is locked', async ({ page }) => {
  await reachReview(page);
  await payAndChoose(page, 'Leave pending');
  for (const path of [MENU, `${MENU}/cart`, `${MENU}/details`, `${MENU}/checkout`]) {
    await page.goto(path);
    await expect(page).toHaveURL(RETURN);
    await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  }
});

test('the return page ignores what the URL claims', async ({ page }) => {
  await reachReview(page);
  await payAndChoose(page, 'Leave pending');
  await page.goto(`${MENU}/payment/return?code=PAYMENT_SUCCESS&status=paid&checkout=forged`);
  await expect(page.getByRole('heading', { name: 'Confirming payment…' })).toBeVisible();
  await notPaid(page);
});

test('gateway_error: the payment page explains it and offers a retry', async ({
  page,
  context,
}) => {
  await reachReview(page);
  await setScenario(context, 'gateway_error');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page).toHaveURL(RETURN);
  await expect(page.getByRole('heading', { name: "We couldn't start the payment" })).toBeVisible();
  await expectNoAxeViolations(page); // gateway error
  await expect(page.getByRole('button', { name: 'Retry payment' })).toBeEnabled();
});

test('attempt_failed: the next poll shows Payment not completed', async ({ page, context }) => {
  await reachReview(page);
  await payAndChoose(page, 'Leave pending');
  await setScenario(context, 'attempt_failed');
  await expect(page.getByRole('heading', { name: 'Payment not completed' })).toBeVisible({
    timeout: 10_000,
  });
});

test('still_confirming: retrying waits for the unconfirmed attempt', async ({ page, context }) => {
  await reachReview(page);
  await payAndChoose(page, 'Leave pending');
  await setScenario(context, 'still_confirming');
  await page.getByRole('button', { name: 'Go back to payment' }).click();
  await expect(
    page.getByRole('heading', { name: 'Still confirming your previous payment…' }),
  ).toBeVisible();
});

for (const [scenario, message] of [
  ['price_changed', 'Some prices changed since you reviewed your order. Please review it again.'],
  ['tax_changed', 'The tax rate changed since you reviewed your order. Please review it again.'],
  [
    'payment_config_missing',
    "This restaurant can't take orders right now. Please ask a member of staff.",
  ],
  ['table_inactive', "This table isn't taking orders right now. Please ask a member of staff."],
] as const) {
  test(`${scenario}: Pay is refused with an explanation`, async ({ page, context }) => {
    await reachReview(page);
    await setScenario(context, scenario);
    await page.getByRole('button', { name: 'Pay' }).click();
    await expect(alertWith(page)).toContainText(message);
    await expect(page).toHaveURL(new RegExp(`${MENU}/checkout$`));
    if (scenario !== 'payment_config_missing') {
      await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
    }
    await expectNoAxeViolations(page);
  });
}

test('a dish that became unavailable before Pay sends the customer to the cart', async ({
  page,
  context,
}) => {
  await reachReview(page);
  await setScenario(context, 'dal_unavailable');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart\\?changed=availability$`));
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toContainText('Unavailable');
});
