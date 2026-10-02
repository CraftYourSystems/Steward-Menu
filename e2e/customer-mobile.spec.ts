import { expect, test, type Page } from '@playwright/test';
import { MOCK_QR, MOCK_RESTAURANT_NAME } from '../src/test/factories/customer';

/**
 * Layout checks for the customer pages at the configured viewport. They run in
 * every Playwright project, so the `mobile-chromium` project (Pixel 7) proves
 * the customer flow fits a phone screen: nothing scrolls sideways, and the
 * page can still be zoomed.
 */

async function expectFitsViewport(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test('the menu fits the viewport without horizontal scrolling', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  await expect(page.getByRole('heading', { level: 1, name: MOCK_RESTAURANT_NAME })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mains' })).toBeVisible();
  await expectFitsViewport(page);
});

test('entry problem states fit the viewport', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.inactive}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Table unavailable' })).toBeVisible();
  await expectFitsViewport(page);
});

test('pinch-zoom is never disabled', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
  expect(viewport).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i);
});

test('the cart page fits the viewport without horizontal scrolling', async ({ page }) => {
  await page.goto(`/t/${MOCK_QR.table1}`);
  await page.getByRole('button', { name: 'Add Dal Makhani' }).click();
  await expect(page.getByText('1 in cart')).toBeVisible();
  await page.goto(`/t/${MOCK_QR.table1}/cart`);
  await expect(page.getByRole('listitem', { name: 'Dal Makhani' })).toBeVisible();
  await expectFitsViewport(page);
});
