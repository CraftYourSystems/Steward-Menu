# Steward Menu — Customer Application Engineering Rules

## 1. Project Identity

This repository is the **customer-facing application** of Steward 1.0: QR → Menu → Cart → Name + Mobile → Checkout → PhonePe → Order status.

- `Steward-Backend` (FastAPI) owns every business rule.
- `Steward-Frontend` is the restaurant operational application.
- This application is used by restaurant guests on their phones. They have **no account** and never sign in.

## 2. Authoritative Documentation

The product contract lives in `Steward-Frontend/docs/` and is authoritative:

- `features/F-01-decision-register.md` — locked decisions F1-01 to F1-39
- `features/F-01-technical-design.md` — endpoints, session model, slices S1–S7
- `frontend-route-map.md` §1 — customer routes and decisions R1–R4
- `auth-contract.md` §16, §19 — Origin checks, host-only `SameSite=Lax` cookies
- `architecture.md` — Master Architecture

This repository's [docs/architecture.md](docs/architecture.md) explains how the app implements them. Never change product behavior here that the contract does not define. If the contract is silent or contradictory, stop and ask.

## 3. Build in Vertical Slices

Build F-01 slice by slice (S1 → S7 in the technical design). Each slice crosses UI, API integration, tests and docs. Do not build later-slice behavior early, and do not add routes for deferred behavior (customer order history, cancellation, editing, cash/card payment).

## 4. The Backend Is the Authority

The frontend never decides or computes:

- prices, subtotals, tax or totals (display backend amounts with `Money`);
- item availability (the backend returns only available items);
- payment success (only backend-verified status counts);
- order state (events trigger a refetch; the UI never applies a state from an event directly).

## 5. Customer Security Rules

- The customer session is the HttpOnly `steward_customer_session` cookie, set by the API host. JavaScript never reads it.
- **Never** store customer session, cart or order data in `localStorage`, `sessionStorage`, IndexedDB or URLs.
- Customer data is fetched **in the browser only** (`customerGet` / `customerSend`, `credentials: 'include'`). No server-side customer fetching, no cookie forwarding, no API proxy unless the contract requires one.
- Customer writes send **no** CSRF token and never call `/auth/csrf` (F1-23).
- There is **no** `/login`, no restaurant-user session and no redirect to a sign-in page. A customer 401 is handled on the page.
- Unknown QR codes and resources show one generic state that reveals nothing about what exists.
- Never use `SameSite=None`, and never weaken a security test to make something pass.
- Only browser-safe values go in `NEXT_PUBLIC_*` variables. Never commit secrets or `.env` values.

## 6. Technology

Next.js (App Router), React, TypeScript (strict), TanStack Query, Zod, Tailwind CSS, Vitest + React Testing Library + MSW, Playwright + axe, ESLint + Prettier, pnpm, Node 24. Do not add a dependency without a clear reason; check whether the existing stack already covers it.

## 7. Code Conventions

- Validate every API response with Zod at the boundary; branch on error `code`, never on `message`.
- Server state goes through TanStack Query; local UI state stays local.
- Keep components small and readable, matching the surrounding code.
- MSW, fixtures and the mock API stay under `src/test/`; ESLint forbids importing them from application code.

## 8. Design

- Mobile-first, touch-friendly, fast to scan.
- Use the Steward tokens (`src/styles/tokens.css`, `src/app/globals.css`); never scatter raw colour values in components.
- Restaurant branding comes from the backend (F8-BCD-5) and is contrast-checked; until it exists, the Steward base design applies.
- The original prototype in this repository's history (commit `d2fba7a`) is a **visual reference only**. Never bring back its localStorage state, static data, simulated payment, fake order IDs or status, client-side pricing or tax, add-ons, description search, order history, cancellation or reorder.

## 9. Accessibility

Accessibility is required: semantic HTML, real buttons and labels, keyboard operation, visible focus, `prefers-reduced-motion` for animation, and a zoomable viewport (never `user-scalable=no` or `maximum-scale=1`). Every customer state is checked with axe.

## 10. Testing

Every change keeps these green: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e` (Desktop Chrome and Pixel 7), `pnpm build` + `pnpm check:bundle`, and `pnpm test:e2e:backend` against a real FastAPI for anything that touches the API. Test every page state: loading, success, empty, each documented error, and session expiry.

## 11. Git

- Never push, force-push or rewrite history without explicit instruction.
- Never skip hooks (`--no-verify`).
- Commit messages carry **no** AI co-author trailers.
- Never commit generated artifacts, secrets or `.env` values.
