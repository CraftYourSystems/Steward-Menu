import { expect, test, type Page } from '@playwright/test';
import { localDatabaseAvailable, setDishAvailable } from './local-database';

/**
 * Customer details, special instructions and Review (F-01 S3) against the real
 * local FastAPI (playwright.backend.config.ts) and a database seeded with the
 * backend's `seed_ordering`, whose fixture tax rate is 500 basis points (5 %).
 * Prices: Dal Makhani ₹220.00, Masala Chaas ₹60.00, Paneer Tikka ₹249.00.
 */

const QR = process.env.E2E_CUSTOMER_QR_TABLE_1;
const API = process.env.E2E_API_BASE_URL;
const MENU = `/t/${QR}`;

test.skip(!QR, 'Needs E2E_CUSTOMER_QR_TABLE_1 from the seed command.');

async function addFromMenu(page: Page, ...dishes: string[]) {
  await page.goto(MENU);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const dish of dishes) {
    const add = page.getByRole('button', { name: `Add ${dish}` });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(add).toBeEnabled();
  }
}

async function giveDetails(page: Page, name = 'Asha Rao', mobile = '+91 98765-43210') {
  await page.goto(`${MENU}/details`);
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page).toHaveURL(new RegExp(`${MENU}/checkout$`));
}

async function reviewOrder(page: Page) {
  await page.getByRole('button', { name: 'Review order' }).click();
  await expect(page.getByRole('region', { name: 'Amounts' })).toBeVisible();
}

function amounts(page: Page) {
  return page.getByRole('region', { name: 'Amounts' });
}

test('QR → menu → cart → note → details → review, priced by the server', async ({ page }) => {
  await addFromMenu(page, 'Dal Makhani', 'Dal Makhani', 'Masala Chaas');
  await page.getByRole('link', { name: 'View cart' }).click();
  const dal = page.getByRole('listitem', { name: 'Dal Makhani' });
  await dal.getByRole('button', { name: 'Add instructions for Dal Makhani' }).click();
  await dal.getByRole('textbox', { name: 'Instructions for Dal Makhani' }).fill('less oil');
  await dal.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('listitem', { name: 'Dal Makhani (less oil)' })).toBeVisible();

  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  await giveDetails(page);

  // Reading the checkout never creates one: two reads, both 404.
  for (let read = 0; read < 2; read += 1) {
    expect((await page.request.get(`${API}/customer/checkout`)).status()).toBe(404);
  }

  await reviewOrder(page);
  const order = page.getByRole('region', { name: 'Your order', exact: true });
  await expect(order).toContainText('2 × Dal Makhani');
  await expect(order).toContainText('Note: less oil');
  // 2 × 220.00 + 60.00 = 500.00; 5 % = 25.00; total 525.00.
  await expect(amounts(page)).toContainText('Subtotal₹500.00');
  await expect(amounts(page)).toContainText('Tax₹25.00');
  await expect(amounts(page)).toContainText('Total₹525.00');
  await expect(page.getByRole('region', { name: 'Your details', exact: true })).toContainText(
    '+91 98765 43210',
  );
  await expect(page.getByRole('button', { name: /pay|place order|phonepe/i })).toHaveCount(0);

  // The open checkout survives a reload; so do the details.
  await page.reload();
  await expect(amounts(page)).toContainText('Total₹525.00');
  const checkout = await (await page.request.get(`${API}/customer/checkout`)).json();
  expect(checkout.data.status).toBe('open');
  await page.goto(`${MENU}/details`);
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveValue('9876543210');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('cart and details changes invalidate the review', async ({ page }) => {
  await addFromMenu(page, 'Masala Chaas');
  await giveDetails(page);
  await reviewOrder(page);
  await expect(amounts(page)).toContainText('Total₹63.00');

  await addFromMenu(page, 'Paneer Tikka');
  await page.goto(`${MENU}/checkout`);
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
  await reviewOrder(page);
  // 60.00 + 249.00 = 309.00; 5 % = 15.45; total 324.45.
  await expect(amounts(page)).toContainText('Total₹324.45');

  await giveDetails(page, 'Asha R', '9876543210');
  await expect(page.getByRole('button', { name: 'Review order' })).toBeVisible();
  expect((await page.request.get(`${API}/customer/checkout`)).status()).toBe(404);
});

test('a dish that became unavailable before Review sends the customer back to the cart', async ({
  page,
}) => {
  test.skip(
    !localDatabaseAvailable,
    'Needs E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME to change menu availability locally.',
  );
  await addFromMenu(page, 'Paneer Tikka', 'Masala Chaas');
  await giveDetails(page);
  setDishAvailable(QR!, 'Paneer Tikka', false);
  try {
    await page.getByRole('button', { name: 'Review order' }).click();
    await expect(page).toHaveURL(new RegExp(`${MENU}/cart\\?changed=availability$`));
    await expect(page.getByRole('listitem', { name: 'Paneer Tikka' })).toContainText('Unavailable');
    expect((await page.request.get(`${API}/customer/checkout`)).status()).toBe(404);

    await page.getByRole('button', { name: 'Remove Paneer Tikka' }).click();
    await expect(page.getByRole('listitem', { name: 'Paneer Tikka' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await reviewOrder(page);
    await expect(amounts(page)).toContainText('Total₹63.00');
  } finally {
    setDishAvailable(QR!, 'Paneer Tikka', true);
  }
});
