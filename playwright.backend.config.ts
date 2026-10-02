import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a **running local FastAPI** (not the mock API): real customer
 * sessions, the real `steward_customer_session` cookie and the menu from the
 * database. Opt-in:
 *
 *   pnpm test:e2e:backend
 *
 * Needs (see README.md):
 * - FastAPI running, with `STEWARD_CORS_ALLOWED_ORIGINS` including this app's
 *   origin (`http://localhost:3320`), because QR entry checks `Origin`.
 * - `E2E_API_BASE_URL`: the FastAPI base URL including `/api/v1`.
 * - Seeded QR codes from the backend's `app.cli.seed_ordering`:
 *   `E2E_CUSTOMER_QR_TABLE_1`, `E2E_CUSTOMER_QR_TABLE_2`, `E2E_CUSTOMER_QR_INACTIVE`.
 *
 * Tests run one at a time: they share one seeded database.
 */

const APP_PORT = 3320;

if (!process.env.E2E_API_BASE_URL) {
  throw new Error('playwright.backend.config.ts needs E2E_API_BASE_URL. See README.md.');
}
const apiBaseUrl = process.env.E2E_API_BASE_URL as string;

export default defineConfig({
  testDir: './e2e/real-backend',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    // Customers order on their phones: every customer flow also runs at a mobile viewport.
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], channel: 'chromium' } },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${APP_PORT}`,
    port: APP_PORT,
    env: { NEXT_PUBLIC_API_BASE_URL: apiBaseUrl },
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
