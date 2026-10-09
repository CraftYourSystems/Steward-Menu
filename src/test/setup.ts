import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { setRealtimeSocketFactory } from '@/lib/realtime/use-customer-realtime';
import { FakeSocket } from './fake-socket';
import { resetMockCarts } from './msw/handlers/customer';
import { mswServer } from './msw/node';
import { resetNavigation } from './next-navigation';

vi.mock('next/navigation', async () => (await import('./next-navigation')).nextNavigationMock);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
// jsdom has no backend socket: every page gets an inert one unless a test drives its own.
beforeEach(() => setRealtimeSocketFactory((url) => new FakeSocket(url)));
afterEach(() => {
  mswServer.resetHandlers();
  resetMockCarts();
  resetNavigation();
  cleanup();
});
afterAll(() => mswServer.close());
