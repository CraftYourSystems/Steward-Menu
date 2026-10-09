import { defineConfig, devices } from '@playwright/test';

/**
 * Servers are started by `node` directly, not through `pnpm start`: pnpm runs
 * a script in its own process group, so on Linux Playwright's teardown killed
 * pnpm but left `next-server` running, and the run never ended (CI hung after
 * every test had passed). Started this way, they are stopped with Playwright.
 */
const NEXT_START = 'node node_modules/next/dist/bin/next start';

const APP_PORT = 3310;
// Overridable so the suite can run while a development mock API holds 8788.
const MOCK_API_PORT = Number(process.env.E2E_MOCK_API_PORT ?? 8788);
const MOCK_API_URL = `http://localhost:${MOCK_API_PORT}`;

/**
 * E2E runs a production build against the standalone mock API. `e2e/real-backend`
 * is excluded: it needs a running FastAPI and has its own config
 * (`playwright.backend.config.ts`, `pnpm test:e2e:backend`).
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: 'real-backend/**',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs src/test/mock-api/server.ts',
      port: MOCK_API_PORT,
      env: { MOCK_API_PORT: String(MOCK_API_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `pnpm build && ${NEXT_START} --port ${APP_PORT}`,
      port: APP_PORT,
      env: { NEXT_PUBLIC_API_BASE_URL: MOCK_API_URL },
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
