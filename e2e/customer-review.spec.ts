import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * Customer details, special instructions and Review (F-01 S3) against the
 * standalone mock API, which mirrors the backend's rules (500 basis points,
 * half up; any cart or details change supersedes the open review). The real
 * backend is exercised by `e2e/real-backend/customer-review.spec.ts`.
 */

const MENU = `/t/${MOCK_QR.table1}`;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function setScenario(context: BrowserContext, scenario: string) {
  await context.addCookies([
    { name: 'mock_scenario', value: scenario, domain: 'localhost', path: '/' },
  ]);
}

/** The visible notice (not Next.js's `role=alert` route announcer). */
function alertWith(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

async function addFromMenu(page: Page, ...dishes: string[]) {
  await page.goto(MENU);
  await expect(page.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME })).toBeVisible();
  for (const dish of dishes) {
    const add = page.getByRole('button', { name: `Add ${dish}` });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(add).toBeEnabled();
  }
}

async function addNote(page: Page, line: string, note: string) {
  const row = page.getByRole('listitem', { name: line });
  await row.getByRole('button', { name: `Add instructions for ${line}` }).click();
  await row.getByRole('textbox', { name: `Instructions for ${line}` }).fill(note);
  await row.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('listitem', { name: `${line} (${note})` })).toBeVisible();
}

async function giveDetails(page: Page, name = 'Asha Rao', mobile = '+91 98765-43210') {
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/checkout$`));
}

async function reviewOrder(page: Page) {
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.getByRole('region', { name: 'Amounts' })).toBeVisible();
}

/** QR → menu → cart with a note → details → review. */
async function reachReview(page: Page) {
  await addFromMenu(page, 'Dal Makhani', 'Dal Makhani', 'Masala Chaas');
  await page.getByRole('link', { name: 'View cart' }).click();
  await addNote(page, 'Dal Makhani', 'less oil');
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  await giveDetails(page);
  await reviewOrder(page);
}

test('QR → menu → cart → note → details → review shows the server-priced order', async ({
  page,
}) => {
  await addFromMenu(page, 'Dal Makhani', 'Dal Makhani', 'Masala Chaas');
  await page.getByRole('link', { name: 'View cart' }).click();
  await addNote(page, 'Dal Makhani', 'less oil');
  await expectNoAxeViolations(page); // cart with a note

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toBeVisible();
  await expectNoAxeViolations(page); // details form
  await giveDetails(page);
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
  await expectNoAxeViolations(page); // ready to review

  await reviewOrder(page);
  const order = page.getByRole('region', { name: 'Your order', exact: true });
  await expect(order).toContainText('2 × Dal Makhani');
  await expect(order).toContainText('Note: less oil');
  await expect(order).toContainText('1 × Masala Chaas');
  const amounts = page.getByRole('region', { name: 'Amounts' });
  await expect(amounts).toContainText('Subtotal₹500.00');
  await expect(amounts).toContainText('Tax₹25.00');
  await expect(amounts).toContainText('Total₹525.00');
  await expect(page.getByRole('region', { name: 'Your details', exact: true })).toContainText(
    '+91 98765 43210',
  );
  // S4: one Pay action (never PhonePe or "place order"), and nothing kept in the browser.
  await expect(page.getByRole('button', { name: 'Pay', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /place order|phonepe/i })).toHaveCount(0);
  await expect(page.getByText(/phonepe/i)).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expectNoAxeViolations(page); // reviewed order
});

test('reloading keeps the saved details and the open review', async ({ page }) => {
  await reachReview(page);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('₹525.00');

  await page.goto(`${MENU}/details`);
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Asha Rao');
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9876543210');
});

test('a cart change invalidates the review', async ({ page }) => {
  await reachReview(page);
  await addFromMenu(page, 'Paneer Tikka');
  await page.goto(`${MENU}/checkout`);
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
  await reviewOrder(page);
  await expect(page.getByRole('region', { name: 'Amounts' })).toContainText('Total₹786.45');
});

test('a details change invalidates the review', async ({ page }) => {
  await reachReview(page);
  await page.goto(`${MENU}/details`);
  await giveDetails(page, 'Asha R', '9876543210');
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
  await reviewOrder(page);
  await expect(page.getByRole('region', { name: 'Your details', exact: true })).toContainText(
    'Asha R',
  );
});

test('details are validated by the server and shown next to each field', async ({ page }) => {
  await addFromMenu(page, 'Masala Chaas');
  await page.goto(`${MENU}/details`);
  await page.getByRole('textbox', { name: 'Name' }).fill('  ');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('5876543210');
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expectNoAxeViolations(page); // details with field errors
});

test('a dish that became unavailable sends the customer back to the cart', async ({
  page,
  context,
}) => {
  await addFromMenu(page, 'Dal Makhani', 'Masala Chaas');
  await page.goto(`${MENU}/details`);
  await giveDetails(page);
  await setScenario(context, 'dal_unavailable');
  await page.getByRole('button', { name: 'Review order' }).click();

  await expect(page).toHaveURL(new RegExp(`${MENU}/cart\\?changed=availability$`));
  await expect(alertWith(page)).toContainText('no longer available');
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toContainText('Unavailable');
  await expect(page.getByText('Remove unavailable dishes to continue.')).toBeVisible();
  await expectNoAxeViolations(page); // cart after revalidation
});

test('missing tax configuration and an inactive table are explained, nothing else', async ({
  page,
  context,
}) => {
  await addFromMenu(page, 'Masala Chaas');
  await page.goto(`${MENU}/details`);
  await giveDetails(page);

  await setScenario(context, 'tax_missing');
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(alertWith(page)).toContainText("This restaurant can't take orders right now.");
  await expectNoAxeViolations(page); // configuration error

  await setScenario(context, 'table_inactive');
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(alertWith(page)).toContainText("This table isn't taking orders right now.");
});

test('Review needs a cart and details: it sends the customer where to fix them', async ({
  page,
}) => {
  await page.goto(MENU);
  await page.goto(`${MENU}/checkout`);
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/cart$`)); // empty cart

  await addFromMenu(page, 'Masala Chaas');
  await page.goto(`${MENU}/checkout`);
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/details$`)); // no details yet
});
