import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetMockCarts } from './msw/handlers/customer';
import { mswServer } from './msw/node';

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mswServer.resetHandlers();
  resetMockCarts();
  cleanup();
});
afterAll(() => mswServer.close());
