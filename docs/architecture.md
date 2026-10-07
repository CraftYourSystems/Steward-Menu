# Steward Menu — Customer Application Architecture

This document explains how the customer application implements the F-01 Order Flow contract. The contract itself is in `Steward-Frontend/docs/`:

- `features/F-01-decision-register.md` (F1-01 to F1-39, locked)
- `features/F-01-technical-design.md` (endpoints, session, slices S1–S7)
- `frontend-route-map.md` §1 (customer routes, decisions R1–R4)
- `auth-contract.md` §16, §19 (Origin checks, host-only `SameSite=Lax` cookies)

Where this document and the contract differ, the contract wins.

## Principles

- **The backend is the authority.** FastAPI decides the session, table, menu, availability, prices, tax, payment and order state. This app displays what the backend returns and never computes amounts.
- **Customers have no account.** There is no sign-in, no `/login`, no restaurant-user session and no CSRF token fetch. A customer 401 means the table session ended; it is handled on the page, never by a redirect. `src/test/no-login-redirect.test.ts` enforces this.
- **Browser-only customer data (TD-3).** Every customer request is made from the browser with `credentials: 'include'`. Server components render no customer data and never forward cookies.
- **No browser storage for customer state (F1-01).** The session lives only in the HttpOnly `steward_customer_session` cookie, set by the API host. Nothing goes in `localStorage` or `sessionStorage`; tests assert this.
- **Mocks never ship.** MSW, fixtures and the mock API live under `src/test/`; ESLint forbids importing them from application code, and `pnpm check:bundle` verifies the production build.

## Structure

```text
src/
├── app/
│   ├── layout.tsx                 # fonts, global styles, customer query client, mobile container
│   ├── t/[qrCode]/(ordering)/     # route group (adds nothing to the URL): the ordering pages
│   │   ├── layout.tsx             # R1: the session boundary for every ordering page
│   │   ├── page.tsx               # the menu with search and cart controls
│   │   ├── cart/page.tsx          # the server-side cart (S2, S3)
│   │   ├── details/page.tsx       # Name + mobile (S3)
│   │   ├── checkout/page.tsx      # the review step (S3) with Pay (S4)
│   │   └── payment/return/page.tsx    # the payment return page (S4); placed → order page, paid-not-placed (S5)
│   ├── t/[qrCode]/orders/[orderRef]/page.tsx  # the order page (S6), outside the session boundary
│   ├── not-found.tsx              # generic; reveals nothing about restaurants or tables
│   └── error.tsx                  # last-resort error state
├── features/
│   ├── customer-session/          # POST /customer/sessions, session boundary and context, entry problem states, query keys
│   ├── customer-menu/             # GET /customer/menu, menu schema, view, page, name search
│   ├── customer-cart/             # /customer/cart API, schema, hooks, cart page, notes, quantity control, problems
│   ├── customer-details/          # /customer/details API, schema, field-error mapping, details page
│   ├── customer-checkout/         # /customer/checkout API, schema, review problems, review page;
│   │                              #   S4: payment API, payment problems, status polling, return page
│   └── customer-order/            # S6: order read and link redemption API, schemas, status copy and
│                                  #   no-regression rule, realtime hook, order page
├── lib/
│   ├── api/request.ts             # fetch with timeout, Zod contract validation
│   ├── api/errors.ts              # error envelope → ApiError, safe user messages, Retry-After
│   ├── api/customer.ts            # customerGet / customerSend: credentials: 'include', no CSRF token
│   ├── api/query-client.ts        # TanStack Query defaults; no 401 redirect
│   ├── env.ts                     # NEXT_PUBLIC_API_BASE_URL validation
│   ├── format/money.ts            # paise → INR display
│   ├── navigation.ts              # leaveForPayment: the one full-page navigation to the gateway (S4)
│   └── realtime/connection.ts     # the customer WebSocket: dedupe, resync, backoff, 4440 (S6)
├── components/ui/                 # Button, StatePanel, ErrorState, EmptyState, Skeleton, Money
├── styles/tokens.css              # Steward brand primitives
└── test/                          # MSW handlers, factories, mock API, setup (never shipped)
e2e/                               # Playwright against the mock API
e2e/real-backend/                  # Playwright against a running FastAPI
```

## S1 flow

1. Every `/t/[qrCode]` page renders inside `CustomerSessionBoundary` (the route layout), in the browser.
2. `POST /customer/sessions { qr_code }` creates or resumes the session. The backend sets the cookie; the body carries only the restaurant name, table number and session stage.
3. Entry problems map from the error `code`, never the message: unknown QR → one generic "We couldn't find this table" (404); inactive table → "Table unavailable" (`409 table_unavailable`); session at another table → "Your order is at Table N" (`409 customer_session_other_table`); rate limited → wait and retry (429, `Retry-After`).
4. `GET /customer/menu` returns the session restaurant's available items grouped by category, plus uncategorized items shown as "Other dishes".
5. A 401 on any customer request (the session expired after 5 minutes without activity) re-runs entry once with the same QR code, like a rescan. Since S2 the customer is told the session ended and the cart was emptied (technical design §6). If a request still answers 401 after re-entering, the browser is not keeping the cookie and the customer is asked to allow cookies. A fresh visit after expiry simply starts a new session: nothing answers 401, so there is nothing to explain.

## S2 flow (server-side cart)

1. The cart belongs to the session cookie; the browser only ever sends a dish or line ID and a quantity (`POST /customer/cart/lines`, `PATCH`/`DELETE /customer/cart/lines/{id}`), never a price, restaurant or total.
2. Every cart endpoint answers with the whole cart: current base prices (no price lock before Review, F1-09), availability per line, and the subtotal and item count of the **available** lines. The UI renders that response as is; nothing is calculated or updated optimistically. Cart controls are disabled while a change is saved, so responses never arrive out of order.
3. One line per dish; quantity 1 to 20 (TD-10). Decreasing from 1 removes the line. A dish that became unavailable stays in the cart, marked, out of the subtotal; it can be decreased or removed but not increased (`422 item_unavailable`).
4. Errors map by `code`: `item_unavailable` → explained, menu and cart reloaded; `404` → the line is gone, menu and cart reloaded; `validation_failed` with `cart_line_quantity_max` → the per-dish limit; `429` → wait (`Retry-After` seconds shown, nothing retried automatically); `401` → the session-ended flow above.
5. Search filters the loaded menu in the browser by **dish name only** (NFKC, collapsed whitespace, case-insensitive substring; F1-27). It sends no request.
6. No polling, heartbeat or timer-driven request exists (F1-04): only the customer's own actions, a window-focus refetch, and bounded retries of failed reads reach the backend. A Vitest test advances fake timers 10 minutes and asserts zero requests.

## Backend integration

| Topic       | Behavior                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `NEXT_PUBLIC_API_BASE_URL`, including `/api/v1`.                                                                                  |
| Credentials | `credentials: 'include'` on every customer request.                                                                             |
| Writes      | No synchronizer CSRF token (F1-23). The backend checks `Origin`/`Referer` against `STEWARD_CORS_ALLOWED_ORIGINS` and the cookie is `SameSite=Lax`. |
| Errors      | `{ error: { code, message, details?, request_id? } }`. Users see safe messages; the request ID is shown as a reference.        |
| Retries     | Reads retry twice on server or network errors; writes never retry.                                                                |
| CORS        | This app's origin must be in the backend's allow-list. No extra request headers are needed.                                      |

**Hostname topology.** The cookie is host-only and `SameSite=Lax`, set by the API host. A cross-origin `fetch` carries it only when this app and the API are same-site (same registrable domain). Platform default domains on the Public Suffix List make two hosts cross-site. Production hostnames are an open deployment decision (AUTH-OPEN-11); `SameSite=None` is never an option.

## S3 flow (details, instructions, review)

1. **Instructions.** A cart line is (dish, instructions). The menu's Add adds to the dish's line without instructions and shows "N in cart"; on the cart page each line's quantity and note are changed, and lines of one dish are told apart by their notes. Notes are plain text (React escapes them), at most 200 characters, and never change a price. Giving a line the same note as another line of the dish merges them on the server.
2. **Details.** `/details` sends Name and mobile exactly as typed; the backend trims, validates and normalizes them (E.164), and field errors come back as codes shown next to each field. No OTP. A reload prefills from `GET /customer/details`.
3. **Review.** `/checkout` reads `GET /customer/checkout`: an open checkout is shown as returned (details, table, line snapshots, subtotal, the "Tax" row, total). Without one, the page offers **Review order**; only that explicit action calls `POST /customer/checkout/review`. The browser never calculates tax or totals.
4. **Invalidation.** Every cart change and every details change supersede the open checkout on the server; the app invalidates its checkout query after each, so the next visit to `/checkout` offers Review again.
5. **Review errors.** `checkout_revalidation_required` sends the customer to `/cart?changed=availability`, where the unavailable lines are marked and Continue is replaced by "Remove unavailable dishes to continue". `cart_empty` goes to the cart, `customer_details_required` to `/details`. `restaurant_configuration_incomplete` and `table_unavailable` show a message asking the customer to talk to staff; no workaround is offered.
6. **Tax-rate provisioning.** Production tax-rate provisioning remains an open F-08 release blocker. S3 implements the configuration dependency and dev/test fixture path but does not create the production configuration surface.

## S4 flow (payment initiation and return)

1. **Pay.** On the reviewed order, **Pay** calls `POST /customer/checkout/{id}/payments` with no body (the backend charges the locked reviewed total) and the browser navigates (`leaveForPayment`) to the returned `redirect_url`, which is accepted only as an `http(s)` URL. In development and tests that is the backend's stand-in gateway page (Fail, Cancel, Leave pending); the mock API serves an equivalent mock gateway page.
2. **Pay refused.** `checkout_revalidation_required` is routed by `details.reasons`: `item_unavailable` → `/cart?changed=availability`; `price_changed`, `tax_changed`, `cart_changed` → Review again with an explanation; `table_unavailable` → the "talk to staff" message. `restaurant_configuration_incomplete` → "this restaurant can't take orders right now". `payment_gateway_unavailable`, `payment_still_confirming` and `payment_retry_limit` hand over to the return page (with an in-memory notice in the query cache, never in storage or the URL).
3. **Payment stage.** QR entry answers `stage: "payment"` while a payment is in progress. The session boundary then sends every other customer page to `/payment/return`. Any `409 cart_locked` from a cart, details or Review write switches the cached stage to `payment`, which does the same.
4. **Return page.** It never reads the gateway's query parameters. It reads `GET /customer/checkout`, then, while the latest attempt awaits payment, polls `GET /customer/checkout/{id}/status` at 2 s, growing by half each time, capped at 30 s (the backend asks the gateway once the attempt is 15 s old and never counts polling as activity). States: **Confirming payment…**; **Still confirming your previous payment…** (an unconfirmed attempt blocks retry and release); **Payment not completed** (Retry payment on the same checkout; Review / change order); **We couldn't start the payment** (gateway error); **Review only** when a dish became unavailable or no attempt is left; **No payment in progress**. It never shows a payment as paid: S4 places no order.
5. **Review / change order** calls `POST /customer/checkout/{id}/release`; the session returns to the cart stage with its lines and the customer goes to the cart (`?changed=availability` when a dish became unavailable).
6. **Release blocker.** Production PhonePe merchant configuration and the PhonePe adapter remain an open F-08 D-11 / Blockers C release blocker. S4 implements the payment flow against the stand-in gateway and does not create the production payment configuration or enable PhonePe.

## S5 flow (verified payment → order placed)

1. **Outcome from the backend only.** After a verified payment the backend reports `placed` (with `order: { token_number, placed_at }`) or `paid_not_placed` on `GET /customer/checkout`. The return page polls as in S4 until the checkout leaves `payment_started`; with the stand-in's **Pay successfully** the signed webhook has usually placed the order before the customer is back, and with **Pay, no webhook** the backend's status query finds it after about 15 seconds.
2. **Order placed (P1).** S5 showed it in place on `/payment/return`; since S6 the return page takes a placed checkout to its order page (`order.order_ref`), which shows the token, items, total and live status.
3. **Paid but not placed (F1-22).** The refund notice: payment received, the order could not be placed because a dish became unavailable, the restaurant handles the refund. No order, no token, no retry.
4. **Session after placement.** QR entry answers `stage: "placed"` (with `order_ref`) or `"payment_issue"`; the session boundary sends a placed session to its order page (S6) and keeps a payment-issue session on `/payment/return`, so a same-table rescan resumes where the customer was. A write answered `409 order_already_placed` (or `cart_locked` for a payment issue) switches the cached stage and takes the customer there.
5. **Mock API.** The mock gateway page adds **Pay successfully** (placed at once, like the signed webhook) and **Pay, no webhook** (placed on the next status poll); the `paid_not_placed` scenario makes a success end paid-not-placed.

## S6 flow (order access, live status, minimal lifecycle)

1. **Order page** `/t/[qrCode]/orders/[orderRef]` reads `GET /customer/orders/{order_ref}`: restaurant, table, token, status with its progress and times, items with notes, subtotal, tax and total paid. Nothing personal (no name or mobile), no staff identities. It sits **outside** the `(ordering)` session boundary, so opening an SMS link on another device never enters a table session there.
2. **Access** is the backend's: the session that placed the order (until Completed), or an order-access grant. An SMS link (`…/orders/{ref}#k={secret}`) is redeemed once: the page reads the fragment, removes it from the address bar and history at once (`history.replaceState`, also on a fragment-only navigation), and posts it to `POST /customer/order-access`, which sets the HttpOnly grant cookie. The secret is kept nowhere. An unknown, wrong, partial or expired link, the reference alone, or ended access all show one generic "This order link isn't available".
3. **Live status.** While the order is not Completed, `src/lib/realtime/connection.ts` keeps `ws(s)://<api host>/ws/customer` open; the cookies authenticate it and the backend fixes what it hears. Events are deduplicated by `event_id` and only trigger a refetch; every (re)connect and the page becoming visible or online again resync from the API; reconnects back off from 1 s to 30 s with jitter; a slow 30 s refresh runs while the socket is down. The page shows **Live updates on** / **Reconnecting…** and **Status as of** the last read. Out-of-order responses never move the status backwards (`newerOrder`).
4. **Completed** ends the placing session (F1-37): the backend sends the Completed event and closes the socket with `4440`; the API then refuses this session, so the page keeps the last order it read, marked Completed (the only time an event's status is shown, after the server ended access). A same-table rescan starts afresh. A grant keeps reading the order until its link expires.
5. **Mock API.** The mock keeps orders, links and grants like the backend and serves `/ws/customer` (`ws` package, never bundled). Mock-only control routes stand in for staff and the SMS: `POST /mock-control/orders/{ref}/advance`, `GET …/link`, `POST …/expire`.
6. **Real-backend E2E.** Staff act through the backend's transition command (`e2e/real-backend/backend-cli.ts`); the suite mints a link exactly like the SMS's in the local database (SMS bodies are cleared once sent).

The original prototype in this repository's history is a visual reference only, never a source of behavior.
