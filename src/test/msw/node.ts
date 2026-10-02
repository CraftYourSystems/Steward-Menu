import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** In-process MSW for Vitest. */
export const mswServer = setupServer(...handlers);
