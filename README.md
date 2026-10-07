# Steward Menu

The customer-facing application of **Steward 1.0**, the restaurant operating system: a customer scans the QR code on their table and orders from their phone.

**QR → Menu → Cart → Name + Mobile → Checkout → PhonePe → Order status** (F-01 Order Flow).

> **Status: F-01 S6.** QR entry, the customer session, the customer menu (S1), the server-side cart and name search (S2), customer details, special instructions and the order review with backend pricing (S3), payment initiation and return against the stand-in gateway (S4), verified payment → order placement (S5), and the order page with SMS-link access and live status (S6) are implemented and integrated with FastAPI.
>
> Production tax-rate provisioning remains an open F-08 release blocker. S3 implements the configuration dependency and dev/test fixture path but does not create the production configuration surface. Until it exists, Review in production shows "This restaurant can't take orders right now".

Steward has three repositories:

| Repository            | Role                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| `Steward-Backend`     | FastAPI + PostgreSQL. Owns every business rule, price and state.      |
| `Steward-Frontend`    | Restaurant operational app (Owner, Admin, Kitchen, Service, Billing). |
| `Steward-Menu` (this) | Customer app. Customers have no account and never sign in.            |

The product contract (F-01 decision register and technical design, route map, auth contract) lives in `Steward-Frontend/docs/` and is authoritative. See [docs/architecture.md](docs/architecture.md) for how this app implements it.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · TanStack Query · Zod · Tailwind CSS 4 · Vitest + React Testing Library + MSW · Playwright + axe · ESLint + Prettier · pnpm 12 · Node 24.

## Routes

| Route                           | What it does                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/t/[qrCode]`                   | QR entry: creates or resumes the customer session, then shows the session restaurant's available menu (S1), searchable by dish name, with Add and quantity controls and a cart summary (S2).                                                                 |
| `/t/[qrCode]/cart`              | The server-side cart (S2, S3): lines at current base prices with special instructions (a dish can have several lines), quantity changes, notes, removal, the subtotal of available dishes, and Continue. Unavailable dishes stay marked until removed.       |
| `/t/[qrCode]/details`           | Name + Indian mobile number (S3), validated by the backend; no OTP. Prefilled on reload.                                                                                                                                                                     |
| `/t/[qrCode]/checkout`          | The review step (S3): the open checkout with the backend's subtotal, tax and total, or a Review action. Loading the page never creates a checkout. **Pay** (S4) goes to the gateway.                                                                         |
| `/t/[qrCode]/payment/return`    | Where the gateway returns (S4): confirming, not completed, retry or change order; never trusts the URL. A placed order goes on to its order page (S5, S6); paid-but-not-placed shows the refund notice.                                                      |
| `/t/[qrCode]/orders/[orderRef]` | The order page (S6): token, items, total and live status (Placed → Cooking → Ready → Completed). Read by the placing session until Completed, or on any device from the SMS link (`#k=` secret, removed from the URL at once). Outside the session boundary. |

Printed QR codes encode `/t/<qrCode>`; the hostname in front of it is configurable and not fixed in code. Every page under `/t/[qrCode]` enters or resumes the session itself, so a direct visit or reload of `/cart` keeps the same session and cart.

## Local development

Ports used by this app (chosen so it runs next to Steward-Frontend on 3000/3100/3200 and its mock API on 8787):

| Port   | Use                                   |
| ------ | ------------------------------------- |
| `3300` | `pnpm dev`                            |
| `3310` | `pnpm test:e2e` (production build)    |
| `3320` | `pnpm test:e2e:backend`               |
| `8788` | `pnpm mock:api` (standalone mock API) |

```bash
pnpm install
cp .env.example .env.local      # then set NEXT_PUBLIC_API_BASE_URL
pnpm dev                        # http://localhost:3300
```

### Environment variables

| Name                       | Required | Meaning                                                                                                                       |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Yes      | FastAPI base URL **including `/api/v1`**, e.g. `http://localhost:8000/api/v1`. Inlined into the browser bundle at build time. |

`next dev`, `next build` and `next start` refuse to run while it is missing or malformed. There is no server-only API URL: customer data is fetched in the browser only, never during server rendering. Names live in `.env.example`; values are never committed.

### Against the local FastAPI backend

Run Steward-Backend (see its README) with this app's origins allowed. QR entry checks `Origin`/`Referer` against the same list, so a missing origin shows up as "We couldn't open the menu" (`403 csrf_invalid`):

```bash
STEWARD_CORS_ALLOWED_ORIGINS=http://localhost:3300,http://localhost:3320
```

Add Steward-Frontend's origins to the same comma-separated list when running both apps. Then seed tables and a menu (local and test databases only; the command refuses to run in production):

```bash
python -m app.cli.seed_ordering --owner-email seed-owner@example.com
```

It prints each table's number, state and QR code: tables `1` and `2` are active, `3` is inactive. Open `http://localhost:3300/t/<qr_code>`.

**Cookies.** The backend sets the customer session as the `steward_customer_session` cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`, host-only (no `Domain`). The browser sends it to the API host itself (`credentials: 'include'`); JavaScript never sees it, and nothing is kept in `localStorage` or `sessionStorage`. Cookies are scoped by host, not port, so use `localhost` for both the app and the API, never `127.0.0.1` for one of them. In production, this app's host and the API host must be **same-site** for the `SameSite=Lax` cookie to be sent; the production hostname topology is an open deployment decision (auth contract AUTH-OPEN-11). `SameSite=None` is never used.

### Against the mock API

```bash
pnpm mock:api                                        # http://localhost:8788
NEXT_PUBLIC_API_BASE_URL=http://localhost:8788 pnpm dev
```

The mock serves the same customer contract with MSW handlers (`src/test/msw/handlers/customer.ts`), including the session cookie and a cart per session with the backend's rules. QR codes are in `src/test/factories/customer.ts` (`MOCK_QR`). A `mock_scenario` cookie selects fixtures (`src/test/msw/mock-scenario.ts`): `empty`, `server_error`, `dal_unavailable` (Dal Makhani becomes unavailable), `cart_rate_limited` (cart writes answer 429), `tax_missing` (Review answers `restaurant_configuration_incomplete`) and `table_inactive` (Review answers `table_unavailable`). The mock prices Reviews at 500 basis points, like the backend seed.

## Commands

| Task                          | Command                             |
| ----------------------------- | ----------------------------------- |
| Type check                    | `pnpm typecheck`                    |
| Lint                          | `pnpm lint`                         |
| Format / check format         | `pnpm format` / `pnpm format:check` |
| Unit and component tests      | `pnpm test`                         |
| E2E against the mock API      | `pnpm test:e2e`                     |
| E2E against a running FastAPI | `pnpm test:e2e:backend`             |
| Production build              | `pnpm build`                        |
| No test code in the build     | `pnpm check:bundle` (after a build) |

Playwright runs every spec in two projects: Desktop Chrome and a phone (`Pixel 7`). Customer pages are checked with axe.

### Real-backend E2E

Needs FastAPI running with `http://localhost:3320` in `STEWARD_CORS_ALLOWED_ORIGINS`, a database at the migration head with `seed_ordering` data, and (S4) the stand-in payment gateway: `STEWARD_PAYMENT_GATEWAY=stand_in` and `STEWARD_CUSTOMER_APP_URL=http://localhost:3320` (the seed gives the restaurant the stand-in payment configuration). Then:

```bash
E2E_API_BASE_URL=http://localhost:8000/api/v1
E2E_CUSTOMER_QR_TABLE_1=…  E2E_CUSTOMER_QR_TABLE_2=…  E2E_CUSTOMER_QR_INACTIVE=…   # from seed_ordering
pnpm test:e2e:backend
```

The S6 specs (`customer-order.spec.ts`, Journeys A–G) also need `E2E_BACKEND_DIR` (the Steward-Backend checkout), `E2E_BACKEND_DATABASE_URL` (the backend's local database URL; staff act through `python -m app.cli.transition_order`), and `E2E_POSTGRES_CONTAINER` / `E2E_DATABASE_NAME` (to mint and expire order links locally). Run the backend for this suite with raised per-IP customer limits, for example `STEWARD_CUSTOMER_SESSION_CREATE_LIMIT=1000 STEWARD_CUSTOMER_READ_LIMIT=10000 STEWARD_CUSTOMER_ORDER_ACCESS_IP_LIMIT=500 STEWARD_CUSTOMER_WS_CONNECT_LIMIT=1000` (every journey comes from one address; local configuration only).

The specs are skipped without the QR codes. The suite enters the QR code more often than the backend's default QR-entry limit allows per minute from one address (20), so run the local backend with a higher limit for it, for example `STEWARD_CUSTOMER_SESSION_CREATE_LIMIT=200` (local configuration only). The 5-minute cart expiry is covered by the backend's FakeClock integration tests, not by E2E.

The placement specs (S5) cover Pay successfully (signed webhook), Pay, no webhook (status-query recovery, about 18 seconds) and paid-not-placed (needs `E2E_POSTGRES_CONTAINER` and `E2E_DATABASE_NAME`, like the availability specs). The payment specs (S4) take about 35 seconds each: the backend asks the stand-in for an outcome only once an attempt is 15 seconds old. Production PhonePe merchant configuration and the PhonePe adapter remain an open F-08 D-11 / Blockers C release blocker. S4 implements the payment flow against the stand-in gateway and does not create the production payment configuration or enable PhonePe.

The seed gives the restaurant the dev/test fixture tax rate (500 basis points), which the review specs expect. One review spec makes a dish unavailable during the flow; no customer API can do that, so it changes the local database with `docker exec … psql` and is skipped unless you also set `E2E_POSTGRES_CONTAINER` (for example `steward-backend-postgres-1`) and `E2E_DATABASE_NAME` (the local database the backend uses). It restores the dish afterwards. Never point these at a shared database.

## The old prototype

This repository's original `main` is a Vite prototype of the customer UI (static data, localStorage, simulated payment). It remains in Git history as the first commit (tag `prototype-v0` locally) and is a **visual reference only**: its state, data and business logic are not part of this application.

```bash
git show d2fba7a:src/screens/Menu.css      # read a prototype file
git worktree add ../steward-menu-prototype d2fba7a
```
