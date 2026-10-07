import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

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

function checkUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('unexpected fixture value');
  }
}

/** The restaurant of a seeded QR code (S6: the transition command needs it). */
export function restaurantIdOf(qrCode: string): string {
  checkQr(qrCode);
  return runSql(`SELECT restaurant_id FROM restaurant_tables WHERE qr_code = '${qrCode}'`);
}

/**
 * S6: an order-access link exactly like the placement and status SMS carry
 * (`issue_access_link`): a 256-bit secret of which only the SHA-256 is stored,
 * valid 7 days. Returns the secret for the `#k=` fragment. The SMS bodies
 * themselves are cleared once dispatched, so the suite mints its own link.
 */
export function mintOrderLink(orderRef: string): string {
  checkUuid(orderRef);
  const secret = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(secret, 'ascii').digest('hex');
  runSql(
    `INSERT INTO order_access_links (id, order_id, secret_hash, created_at, expires_at) ` +
      `VALUES (gen_random_uuid(), '${orderRef}', decode('${digest}', 'hex'), now(), ` +
      `now() + interval '7 days')`,
  );
  return secret;
}

/** S6: every link and grant of the order expires, as after 7 days. */
export function expireOrderAccess(orderRef: string): void {
  checkUuid(orderRef);
  for (const table of ['order_access_links', 'order_access_grants']) {
    runSql(
      `UPDATE ${table} SET created_at = now() - interval '2 minutes', ` +
        `expires_at = now() - interval '1 minute' WHERE order_id = '${orderRef}'`,
    );
  }
}

/** Read-only (S6): what the lifecycle recorded for the order. */
export function orderLifecycleRecord(orderRef: string) {
  checkUuid(orderRef);
  return {
    status: runSql(`SELECT status FROM orders WHERE id = '${orderRef}'`),
    history: runSql(
      `SELECT string_agg(state, ',' ORDER BY occurred_at) ` +
        `FROM order_state_history WHERE order_id = '${orderRef}'`,
    ),
    statusSms: Number(
      runSql(
        `SELECT count(*) FROM notification_outbox WHERE order_id = '${orderRef}' ` +
          `AND kind = 'order_status_sms'`,
      ),
    ),
    sessionEndReason: runSql(
      `SELECT coalesce(string_agg(end_reason, ','), '') FROM customer_sessions ` +
        `WHERE order_id = '${orderRef}'`,
    ),
  };
}
