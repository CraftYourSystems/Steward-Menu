import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * Customer QR entry and menu (F-01 S1) against the standalone mock API, which
 * keeps the customer session in the same HttpOnly cookie as FastAPI. The real
 * backend is exercised by `e2e/real-backend/customer-entry.spec.ts`.
 */

const COOKIE = 'steward_customer_session';

async function expectMenu(page: Page, tableNumber: string) {
  await expect(page.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME })).toBeVisible();
  await expect(page.getByText(`Table ${tableNumber}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mains' })).toContainText('Dal Makhani');
  await expect(page.getByRole('region', { name: 'Starters' })).toContainText('Paneer Tikka');
  await expect(page.getByRole('region', { name: 'Other dishes' })).toContainText('Masala Chaas');
}

async function customerCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === COOKIE);
}

test('scanning a table QR opens the menu with the table', async ({ page, context }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);

  await expectMenu(page, '1');
  const cookie = await customerCookie(context);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  // Persistent (Max-Age), so it survives closing the browser (F1-01).
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);
  // Nothing about the session is kept in script-readable storage.
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

for (const qr of [MOCK_QR.unknown, 'not-a-qr-code', '..%2F..%2Fetc']) {
  test(`an invalid QR (${qr}) shows one generic state and no session`, async ({
    page,
    context,
  }) => {
    await page.goto(`/t/${qr}`);

    await expect(
      page.getByRole('heading', { level: 1, name: "We couldn't find this table" }),
    ).toBeVisible();
    expect(await customerCookie(context)).toBeUndefined();
  });
}

test('an inactive table shows Table Unavailable', async ({ page, context }) => {
  await page.goto(`/t/${MOCK_QR.inactive}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Table unavailable' })).toBeVisible();
  expect(await customerCookie(context)).toBeUndefined();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('a different table is refused while the session exists', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  await expectMenu(page, '1');

  await page.goto(`/t/${MOCK_QR.table2}`);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Your order is at Table 1' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mains' })).toHaveCount(0);
});

test('reloading resumes the same session', async ({ page, context }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  await expectMenu(page, '1');
  const before = await customerCookie(context);

  await page.reload();

  await expectMenu(page, '1');
  expect((await customerCookie(context))?.value).toBe(before?.value);
});

test('reopening the browser resumes the session from the persistent cookie', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await firstPage.goto(`/t/${MOCK_QR.table1}`);
  await expectMenu(firstPage, '1');
  // Closing a browser keeps only persistent cookies.
  const kept = (await first.storageState()).cookies.filter((cookie) => cookie.expires > 0);
  expect(kept.map((cookie) => cookie.name)).toContain(COOKIE);
  await first.close();

  const reopened = await browser.newContext();
  await reopened.addCookies(kept);
  const page = await reopened.newPage();
  await page.goto(`/t/${MOCK_QR.table1}`);
  await expectMenu(page, '1');

  // Still bound to table 1.
  await page.goto(`/t/${MOCK_QR.table2}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your order is at Table 1' }),
  ).toBeVisible();
  await reopened.close();
});

test('a customer is never sent to the restaurant sign-in', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  await expectMenu(page, '1');
  await expect(page).toHaveURL(new RegExp(`/t/${MOCK_QR.table1}$`));
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
