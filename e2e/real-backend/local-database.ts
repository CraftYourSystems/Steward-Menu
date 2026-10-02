import { execFileSync } from 'node:child_process';

/*
 * Local-only test support for the real-backend suite: a few specs change menu
 * data that no customer API can change (F-02's menu administration is a later
 * phase), through `psql` inside the local PostgreSQL container. Opt-in: specs
 * using it are skipped unless both variables are set. Never used against any
 * shared or production database.
 */
const CONTAINER = process.env.E2E_POSTGRES_CONTAINER;
const DATABASE = process.env.E2E_DATABASE_NAME;

export const localDatabaseAvailable = Boolean(CONTAINER && DATABASE);

function runSql(statement: string): void {
  if (!CONTAINER || !DATABASE) {
    throw new Error('E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME are required');
  }
  execFileSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      DATABASE,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-c',
      statement,
    ],
    { stdio: 'pipe' },
  );
}

/** Makes one dish of the QR code's restaurant available or unavailable. */
export function setDishAvailable(qrCode: string, dish: string, available: boolean): void {
  if (!/^[A-Za-z0-9_-]+$/.test(qrCode) || !/^[A-Za-z ]+$/.test(dish)) {
    throw new Error('unexpected fixture value');
  }
  runSql(
    `UPDATE menu_items SET is_available = ${available} WHERE name = '${dish}' AND ` +
      `restaurant_id = (SELECT restaurant_id FROM restaurant_tables WHERE qr_code = '${qrCode}')`,
  );
}
