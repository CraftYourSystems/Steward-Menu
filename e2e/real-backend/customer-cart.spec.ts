import { expect, test, type Page } from '@playwright/test';

/**
 * The server-side cart (F-01 S2) against the real local FastAPI
 * (playwright.backend.config.ts). No mocks: the cart lives in PostgreSQL under
 * the real `steward_customer_session`, with prices from the seeded menu. Seed
 * with the backend's `python -m app.cli.seed_ordering` and pass its QR codes
 * (see README.md). Expiry (5 idle minutes) is covered by the backend's
 * FakeClock integration tests, not here.
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const COOKIE = 'steward_customer_session';

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');

/** Each test starts with an empty cart: a fresh browser context is a new device. */
async function openMenu(page: Page) {
  await page.goto(`/t/${QR}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toBeEnabled();
}

function summary(page: Page) {
  return page.getByRole('region', { name: 'Your cart' });
}

test('add, view, change, reload and remove: the real cart persists server-side', async ({
  page,
}) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(page.getByText('1 in cart')).toBeVisible();
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(page.getByText('2 in cart')).toBeVisible();
  await page.getByRole('button', { name: 'Add Masala Chaas' }).click();
  // Seeded prices: Dal Makhani ₹220.00, Masala Chaas ₹60.00.
  await expect(summary(page)).toContainText('3 items · ₹500.00');

  await summary(page).getByRole('link', { name: 'View cart' }).click();
  const dal = page.getByRole('listitem', { name: 'Dal Makhani' });
  await expect(dal).toContainText('₹220.00 each');
  await expect(dal).toContainText('₹440.00');

  await page.reload();
  await expect(dal.getByRole('group', { name: 'Dal Makhani quantity' })).toContainText('2');
  await expect(page.getByRole('listitem', { name: 'Masala Chaas' })).toBeVisible();

  await dal.getByRole('button', { name: 'Decrease Dal Makhani' }).click();
  await expect(dal.getByRole('group', { name: 'Dal Makhani quantity' })).toContainText('1');
  await page.getByRole('button', { name: 'Remove Masala Chaas' }).click();
  await expect(page.getByRole('listitem', { name: 'Masala Chaas' })).toHaveCount(0);
  await expect(page.getByText('₹220.00').first()).toBeVisible();

  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);

  await dal.getByRole('button', { name: 'Remove Dal Makhani' }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
});

test('the cart survives closing and reopening the browser', async ({ page, context, browser }) => {
  await openMenu(page);
  await page.getByRole('button', { name: 'Add Paneer Tikka' }).click();
  await expect(summary(page)).toContainText('1 item');
  const kept = (await context.storageState()).cookies.filter((cookie) => cookie.expires > 0);
  await context.close();

  const reopened = await browser.newContext();
  await reopened.addCookies(kept);
  const again = await reopened.newPage();
  await again.goto(`/t/${QR}/cart`);
  await expect(again.getByRole('listitem', { name: 'Paneer Tikka' })).toContainText('₹249.00 each');
  await reopened.close();
});

test('search finds dishes by name only, and unavailable dishes never appear', async ({ page }) => {
  await openMenu(page);
  const search = page.getByRole('searchbox', { name: 'Search dishes' });
  await search.fill('tikka');
  await expect(page.getByRole('button', { name: 'Add Paneer Tikka' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Dal Makhani' })).toHaveCount(0);

  for (const hidden of ['Biryani', 'Retired', 'Mains']) {
    await search.fill(hidden);
    await expect(page.getByText('No dishes match')).toBeVisible();
  }
});
