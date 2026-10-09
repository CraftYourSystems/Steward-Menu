import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * The server-side cart (F-01 S2) against the standalone mock API, which keeps
 * the cart per customer session cookie exactly as FastAPI does. The real
 * backend is exercised by `e2e/real-backend/customer-cart.spec.ts`.
 */

const COOKIE = 'steward_customer_session';
const MENU = `/t/${MOCK_QR.table1}`;
const CART = `${MENU}/cart`;

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function openMenu(page: Page) {
  await page.goto(MENU);
  await expect(page.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeEnabled();
}

/** The cart notice (not Next.js's `role=alert` route announcer). */
function cartAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

function summary(page: Page) {
  return page.getByRole('region', { name: 'Your cart' });
}

/** A dish's menu row (the menu shows "N in cart" since S3). */
function dishRow(page: Page, name: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: `Add ${name}` }) });
}

async function addDal(page: Page) {
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(dishRow(page, 'Dal Makhani')).toContainText('1 in cart');
}

async function setScenario(context: BrowserContext, scenario: string) {
  await context.addCookies([
    { name: 'mock_scenario', value: scenario, domain: 'localhost', path: '/' },
  ]);
}

test('add from the menu, see the summary, open the cart, reload: the cart persists', async ({
  page,
}) => {
  await openMenu(page);
  await expectNoAxeViolations(page); // menu with search and Add buttons

  await addDal(page);
  await page.getByRole('button', { name: 'Add Masala Chaas' }).click();
  await expect(summary(page)).toContainText('2 items · ₹280.00');
  await expectNoAxeViolations(page); // menu with quantity controls and the summary

  await summary(page).getByRole('link', { name: 'View cart' }).click();
  await expect(page).toHaveURL(new RegExp(`${CART}$`));
  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toContainText('₹220.00 each');
  await expectNoAxeViolations(page); // populated cart

  await page.reload();
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Masala Chaas' })).toBeVisible();
  await expect(page.getByText('₹280.00').first()).toBeVisible();
  // Nothing about the cart or session lives in script-readable storage.
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
});

test('a direct visit to the cart resumes the session; a new browser keeps the cart', async ({
  page,
  context,
  browser,
}) => {
  await openMenu(page);
  await addDal(page);
  const kept = (await context.storageState()).cookies.filter((cookie) => cookie.expires > 0);
  expect(kept.map((cookie) => cookie.name)).toContain(COOKIE);

  // Closing the browser keeps only persistent cookies; reopening goes straight to the cart.
  const reopened = await browser.newContext();
  await reopened.addCookies(kept);
  const again = await reopened.newPage();
  await again.goto(CART);
  await expect(again.getByRole('listitem', { name: 'Dal Makhani' })).toBeVisible();
  await reopened.close();
});

test('change a quantity and remove lines on the cart page', async ({ page }) => {
  await openMenu(page);
  await addDal(page);
  await page.goto(CART);

  const dal = page.getByRole('listitem', { name: 'Dal Makhani' });
  await dal.getByRole('button', { name: 'Increase Dal Makhani' }).click();
  await expect(dal.getByRole('group', { name: 'Dal Makhani quantity' })).toContainText('2');
  await expect(dal).toContainText('₹440.00');
  await dal.getByRole('button', { name: 'Decrease Dal Makhani' }).click();
  await expect(dal.getByRole('group', { name: 'Dal Makhani quantity' })).toContainText('1');

  await dal.getByRole('button', { name: 'Remove Dal Makhani' }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
  await expectNoAxeViolations(page); // empty cart
});

test('search filters the menu by dish name only', async ({ page }) => {
  await openMenu(page);
  const search = page.getByRole('searchbox', { name: 'Search dishes' });

  await search.fill('paneer');
  await expect(page.getByRole('button', { name: 'Add Paneer Tikka' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toHaveCount(0);

  await search.fill('Mains');
  await expect(page.getByText('No dishes match')).toBeVisible();
  await expectNoAxeViolations(page); // no-match state

  await search.fill('');
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeVisible();
});

test('a dish that became unavailable is marked in the cart and refused on the menu', async ({
  page,
  context,
}) => {
  await openMenu(page);
  await addDal(page);
  await page.getByRole('button', { name: 'Add Paneer Tikka' }).click();
  await expect(summary(page)).toContainText('2 items');

  await setScenario(context, 'dal_unavailable');
  // On the open menu, adding more Dal is refused, and the menu is reloaded without it.
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(cartAlert(page)).toContainText("isn't available right now");
  await expect(page.getByRole('region', { name: 'Mains' })).toHaveCount(0);

  await page.goto(CART);
  const dal = page.getByRole('listitem', { name: 'Dal Makhani' });
  await expect(dal).toContainText('Unavailable');
  await expect(dal.getByRole('button', { name: 'Increase Dal Makhani' })).toBeDisabled();
  await expect(page.getByText('Unavailable dishes are not included.')).toBeVisible();
  await expect(page.getByText('Subtotal')).toBeVisible();
  await expectNoAxeViolations(page); // cart with an unavailable line

  await dal.getByRole('button', { name: 'Remove Dal Makhani' }).click();
  await expect(dal).toHaveCount(0);
  await expect(page.getByText('Unavailable dishes are not included.')).toHaveCount(0);
});

test('when the session ends, the customer is told and continues with a new empty cart', async ({
  page,
  context,
}) => {
  await openMenu(page);
  await addDal(page);
  const before = (await context.cookies()).find((cookie) => cookie.name === COOKIE)?.value;

  // The backend treats an expired session exactly like a missing one.
  await context.clearCookies({ name: COOKIE });
  await page.getByRole('button', { name: 'Add Paneer Tikka' }).click();

  await expect(page.getByRole('status', { name: 'Your session ended' })).toContainText(
    'your cart was emptied',
  );
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  const after = (await context.cookies()).find((cookie) => cookie.name === COOKIE)?.value;
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);
  await expect(page).toHaveURL(new RegExp(`${MENU}$`)); // never sent to a sign-in page
  await expectNoAxeViolations(page); // session-ended notice
});

test('when cart changes are rate limited, the customer is asked to wait', async ({
  page,
  context,
}) => {
  await openMenu(page);
  await setScenario(context, 'cart_rate_limited');
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(cartAlert(page)).toContainText(
    'Too many changes at once. Please wait 30 seconds and try again.',
  );
  await expectNoAxeViolations(page); // rate-limited notice
});
