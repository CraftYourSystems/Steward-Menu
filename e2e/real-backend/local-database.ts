import { execFileSync } from 'node:child_process';

/*
 * Local-only test support for the real-backend suite: a few specs change menu
 * data that no customer API can change (F-02's menu administration is a later
 * phase), or read back what the backend recorded, through `psql` inside the
 * local PostgreSQL container. Opt-in: specs using it are skipped unless both
 * variables are set. Never used against any shared or production database.
 */
const CONTAINER = process.env.E2E_POSTGRES_CONTAINER;
const DATABASE = process.env.E2E_DATABASE_NAME;

export const localDatabaseAvailable = Boolean(CONTAINER && DATABASE);

function runSql(statement: string): string {
  if (!CONTAINER || !DATABASE) {
    throw new Error('E2E_POSTGRES_CONTAINER and E2E_DATABASE_NAME are required');
  }
  return execFileSync(
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
      '-t',
      '-A',
      '-c',
      statement,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  ).trim();
}

function checkQr(qrCode: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(qrCode)) throw new Error('unexpected fixture value');
}

/** Makes one dish of the QR code's restaurant available or unavailable. */
export function setDishAvailable(qrCode: string, dish: string, available: boolean): void {
  checkQr(qrCode);
  if (!/^[A-Za-z ]+$/.test(dish)) throw new Error('unexpected fixture value');
  runSql(
    `UPDATE menu_items SET is_available = ${available} WHERE name = '${dish}' AND ` +
      `restaurant_id = (SELECT restaurant_id FROM restaurant_tables WHERE qr_code = '${qrCode}')`,
  );
}

/**
 * Read-only (S5): for the newest `paid_not_placed` checkout at the QR code's
 * table, the kinds of its payment issues, its Paid attempts, and how many orders,
 * daily-token counters for its restaurant and placement SMS reference it.
 */
export function paidNotPlacedRecord(qrCode: string) {
  checkQr(qrCode);
  const checkout =
    `(SELECT c.id FROM checkouts c JOIN restaurant_tables t ON t.id = c.table_id ` +
    `WHERE t.qr_code = '${qrCode}' AND c.status = 'paid_not_placed' ` +
    `ORDER BY c.updated_at DESC LIMIT 1)`;
  return {
    issueKinds: runSql(
      `SELECT coalesce(string_agg(kind, ','), '') FROM payment_issues WHERE checkout_id = ${checkout}`,
    ),
    paidAttempts: Number(
      runSql(
        `SELECT count(*) FROM payment_attempts WHERE checkout_id = ${checkout} AND status = 'paid'`,
      ),
    ),
    orders: Number(runSql(`SELECT count(*) FROM orders WHERE checkout_id = ${checkout}`)),
    sms: Number(
      runSql(
        `SELECT count(*) FROM notification_outbox n JOIN orders o ON o.id = n.order_id ` +
          `WHERE o.checkout_id = ${checkout}`,
      ),
    ),
  };
}
