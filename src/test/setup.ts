import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetMockCarts } from './msw/handlers/customer';
import { mswServer } from './msw/node';
import { resetNavigation } from './next-navigation';

vi.mock('next/navigation', async () => (await import('./next-navigation')).nextNavigationMock);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  resetMockCarts();
  resetNavigation();
  cleanup();
});
afterAll(() => mswServer.close());
