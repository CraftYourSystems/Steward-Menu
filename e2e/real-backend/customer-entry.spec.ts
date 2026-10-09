import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Customer QR entry and menu (F-01 S1) against the real local FastAPI
 * (playwright.backend.config.ts). No mocks: the session is a real
 * `steward_customer_session` issued by the backend, and the menu comes from
 * the database. Seed the data with the backend's `python -m app.cli.seed_ordering`
 * and pass its QR codes (see docs/local-backend.md).
 */

const QR = {
  table1: process.env.E2E_CUSTOMER_QR_TABLE_1,
  table2: process.env.E2E_CUSTOMER_QR_TABLE_2,
  inactive: process.env.E2E_CUSTOMER_QR_INACTIVE,
};
const COOKIE = 'steward_customer_session';

test.skip(
  !QR.table1 || !QR.table2 || !QR.inactive,
  'Needs E2E_CUSTOMER_QR_TABLE_1, E2E_CUSTOMER_QR_TABLE_2 and E2E_CUSTOMER_QR_INACTIVE from the seed command.',
);

async function expectSeededMenu(page: Page, tableNumber: string) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(`Table ${tableNumber}`, { exact: true })).toBeVisible();
  const mains = page.getByRole('region', { name: 'Mains' });
  await expect(mains).toContainText('Dal Makhani');
  await expect(page.getByRole('region', { name: 'Starters' })).toContainText('Paneer Tikka');
  await expect(page.getByRole('region', { name: 'Other dishes' })).toContainText('Masala Chaas');
  // The seed's unavailable and deleted items never reach the customer.
  await expect(page.getByText('Chicken Biryani')).toHaveCount(0);
  await expect(page.getByText('Retired Special')).toHaveCount(0);
}

async function customerCookie(context: BrowserContext) {
  return (await context.cookies()).find((cookie) => cookie.name === COOKIE);
}

test('scanning an active table opens the real menu with a persistent HttpOnly cookie', async ({
  page,
  context,
}) => {
  await page.goto(`/t/${QR.table1}`);

  await expectSeededMenu(page, '1');
  const cookie = await customerCookie(context);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  expect(cookie?.domain).toBe('localhost'); // host-only: no Domain attribute was sent
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
});

test('an unknown or malformed QR shows the generic state', async ({ page, context }) => {
  for (const qr of ['AAAAAAAAAAAAAAAAAAAAAA', 'not-a-qr']) {
    await page.goto(`/t/${qr}`);
    await expect(
      page.getByRole('heading', { level: 1, name: "We couldn't find this table" }),
    ).toBeVisible();
  }
  expect(await customerCookie(context)).toBeUndefined();
});

test('an inactive table shows Table Unavailable and starts no session', async ({
  page,
  context,
}) => {
  await page.goto(`/t/${QR.inactive}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Table unavailable' })).toBeVisible();
  expect(await customerCookie(context)).toBeUndefined();
});

test('a different table is refused, reload and reopen resume the same session', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto(`/t/${QR.table1}`);
  await expectSeededMenu(page, '1');
  const token = (await customerCookie(first))?.value;

  await page.goto(`/t/${QR.table2}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your order is at Table 1' }),
  ).toBeVisible();

  await page.goto(`/t/${QR.table1}`);
  await page.reload();
  await expectSeededMenu(page, '1');
  expect((await customerCookie(first))?.value).toBe(token);

  // Closing the browser keeps only persistent cookies; the session survives.
  const kept = (await first.storageState()).cookies.filter((cookie) => cookie.expires > 0);
  await first.close();
  const reopened = await browser.newContext();
  await reopened.addCookies(kept);
  const again = await reopened.newPage();
  await again.goto(`/t/${QR.table1}`);
  await expectSeededMenu(again, '1');
  expect((await customerCookie(reopened))?.value).toBe(token);
  await reopened.close();
});

test('the customer menu is refused without a customer session', async ({ request }) => {
  const response = await request.get(`${process.env.E2E_API_BASE_URL}/customer/menu`);
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe('customer_session_expired');
});
