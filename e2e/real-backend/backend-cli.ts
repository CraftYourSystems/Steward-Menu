import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/*
 * Local-only test support for the real-backend suite (S6): kitchen and service
 * staff move orders through the backend's own transition service, driven by its
 * operational/test command `python -m app.cli.transition_order` (F1-30: F-05's
 * staff workspaces are a later phase). The command refuses to run in
 * production. Opt-in: needs `E2E_BACKEND_DIR` (the Steward-Backend checkout)
 * and `E2E_BACKEND_DATABASE_URL` (the local database the running backend uses);
 * `E2E_BACKEND_PYTHON` overrides the virtual environment's interpreter.
 */
const DIR = process.env.E2E_BACKEND_DIR;
const DATABASE_URL = process.env.E2E_BACKEND_DATABASE_URL;

export const backendCliAvailable = Boolean(DIR && DATABASE_URL);

export type TransitionTarget = 'cooking' | 'ready_to_serve' | 'completed';
export type Actor = { staffId: string; restaurantId: string } | { accountEmail: string };

/** The command's exit codes (`app/cli/transition_order.py`). */
export const EXIT = {
  moved: 0,
  notFound: 5,
  invalidTransition: 6,
  notAuthorized: 7,
} as const;

function python(dir: string): string {
  return (
    process.env.E2E_BACKEND_PYTHON ??
    join(dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  );
}

export function transitionOrder(orderRef: string, to: TransitionTarget, actor: Actor) {
  if (!DIR || !DATABASE_URL) {
    throw new Error('E2E_BACKEND_DIR and E2E_BACKEND_DATABASE_URL are required');
  }
  const who =
    'accountEmail' in actor
      ? ['--account-email', actor.accountEmail]
      : ['--staff-id', actor.staffId, '--restaurant-id', actor.restaurantId];
  const result = spawnSync(
    python(DIR),
    ['-m', 'app.cli.transition_order', '--order-id', orderRef, '--to', to, ...who],
    {
      cwd: DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        STEWARD_DATABASE_URL: DATABASE_URL,
        STEWARD_CUSTOMER_APP_URL: 'http://localhost:3320',
      },
    },
  );
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
