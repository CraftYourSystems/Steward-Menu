import { customerHandlers } from './customer';

/** Every mocked contract (F-01 S1). Shared by Vitest and the standalone mock API. */
export const handlers = [...customerHandlers];
