# Backend B6: Front-end switch-over, Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read `node_modules/next/dist/docs/` (route handlers, proxy, authentication, data-security, backend-for-frontend, fetching-data, mutating-data, testing/playwright) before writing any Next.js code: this is not the Next.js you know (CLAUDE.md, AGENTS.md).**

**Goal:** Switch the Next.js app from the JSON/in-memory mock layer to the real API for everything Phase 1 (M0 + M1) needs, so the first client can go live: real sign-in with Better Auth (MFA, email verification, device enrolment), real tenant and role, and real data for tasks, shifts, reports, dashboard, Today, settings, account, billing, audit, search, notifications and the platform console. Features that have no backend yet stay on mock data, clearly isolated and hidden outside demo deployments. A seed script turns `public/data/**/*.json` into a demo tenant so the live demo and `npm run smoke` keep working, and Playwright e2e proves the six first-client requirements (CR-01 to CR-06). **B6 is a data-layer switch: the UI looks and behaves the same, except where the backend contract forces a change (loading and error states, optimistic updates and rollback, permission-based hiding).**

**Architecture:** The browser never talks to the API host. Two same-origin Next route handlers (a thin BFF) forward `/v1/*` and `/api/auth/*`; server components call the API directly with a server-only client. Both clients are one small typed `fetch` wrapper over TypeScript types **generated from the API's OpenAPI document** (no `hc<AppType>`, see I2). The session is Better Auth's httpOnly cookie on the web origin; the tenant (`X-Tenant`) is derived on the server from an httpOnly cookie and never taken from client input. Each switched feature keeps `features/<f>/api.ts` as its server-read module and gains `adapters.ts` (pure DTO ↔ FE type mapping, unit-tested) and `client.ts` (browser mutations). Optimistic updates use React 19 `useOptimistic` plus `router.refresh()`, so the server record always wins. The feature in-memory stores of switched features are deleted. Features without a backend stay behind `mockEnabled()`.

**Tech Stack:** Next.js 16 (App Router, route handlers, `proxy.ts`), React 19, existing Vitest; **new dev dependencies: `openapi-typescript` (types only, no runtime) and `@playwright/test`**, both pinned exactly, at least two weeks old, with `npm audit --audit-level=high` green (Ruling I3). No new runtime dependency in the web app. API side: existing Hono + zod-openapi + Better Auth.

**Spec:** `.claude/docs/requirements/SRS.md` (CR-01..06 in §5.1 "First client requirements", AC-M0-01..05 in §4.3, AC-M1-01..07 in §5.4, traceability in §15; FR-M0-03..10, 13, 15; FR-M1-10..14, 20..31, 40..55, 61, 70..80), `.claude/docs/architecture.md` (feature structure, Skeletons), `.claude/docs/00-design-system/ui-rules.md`, `.claude/docs/features/{tasks,shifts,shift-reports,devices,platform}.md` (Backend notes), roadmap B6 and its Review Focus, follow-ups `2026-11-17-backend-b5-followups.md` (F1–F22, G1–G3, H1–H6, "B6 mandatory"), `…b4-followups.md` (D1–D24, E1–E15, "B6 notes"), `…b3-followups.md` (C1–C14), `…b2-followups.md` (B1–B16), `2026-11-16-backend-b0-b1-followups.md` (R1–R29). **Depends on B0–B5.**

## Rulings (made for B6; binding for later phases)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| I1 | Nine tasks. Roadmap T6.1 → T6.1 (contract and transport) + T6.3 (auth and session). T6.2 (switch features) → T6.4 to T6.8, split by dependency and risk. T6.3 (seed) → T6.2 (moved early so every later task runs against the demo tenant). T6.4 (e2e) → T6.9. | One review per concern; T6.2 as one task is unreviewable. | none |
| I2 | **Types come from the OpenAPI document, not `hc<AppType>`.** Verified: `AppType = ReturnType<typeof createApp>` carries no routes (modules are mounted with `app.route(...)` as statements, so `keyof ReturnType<typeof hc<AppType>>` is `never`). Chaining about 160 routes across 30 modules to fix that would be a wide refactor and slow `tsc`. Instead `api/scripts/dump-openapi.ts` builds the app with stub deps (routes only, test-only routes excluded) and writes the 3.1 document; `openapi-typescript` turns it into the committed `lib/api/schema.d.ts`. The web imports only `import type { paths }`: no server code is bundled. `npm run api:types` regenerates; `npm run api:types:check` (CI) fails on drift. **`packages/contracts` is not created** (the roadmap's package): DTO schemas stay in the API, shared pure rules stay in `packages/domain`. | Works today, zero server code in the bundle, and CI catches drift. | a hand-edited generated file or an API change without regeneration (the check job fails) |
| I3 | **One in-house typed client, no `openapi-fetch`, no `better-auth` client in the browser.** `lib/api/client.ts` (about 80 lines) is generic over `paths`: `api.get("/v1/tasks/{id}", { path: { id } })`. `lib/auth-client.ts` is a thin wrapper over the 12 Better Auth endpoints the app uses, with FE Zod schemas for their responses. Better Auth paths and bodies are pinned by contract tests against the real API (T6.1, T6.3), so a version bump that renames an endpoint fails a test. | Zero new runtime dependencies (supply-chain posture of B5 G3); the auth surface is small. | about 100 lines of wrapper to maintain |
| I4 | **Browser → web origin only.** `app/v1/[...path]/route.ts` and `app/api/auth/[...path]/route.ts` forward to `API_URL` (server env, never `NEXT_PUBLIC_*`). The API's `APP_URL` is the public web origin: Better Auth `trustedOrigins`, cookie host and the Google callback all stay valid; there is no CORS. Server components and the `app/actions/*` call `API_URL` directly (no hop). Stripe webhooks (`/webhooks/billing/*`) go to the API host directly, not through the BFF. | The API relies on `SameSite=Lax` httpOnly cookies and `APP_URL`; the app has no subdomains. | one extra hop for browser calls; downloads stream through Next |
| I5 | **`X-Tenant` is derived on the server from the httpOnly cookie `od-tenant` (the tenant slug)** (the app already keeps the active tenant in a cookie, `od-tenant`; there is no subdomain or path tenancy). Only the server action `switchTenant(slug)` writes it, after checking the slug against `GET /v1/me`; sign-in sets it to the first membership. The BFF and `apiServer()` **drop any inbound `x-tenant`**, set it from the cookie, and the API's membership check stays the authority (a forged cookie is a 404). Two tabs share one active tenant, so browser calls also send `x-od-tenant` = the slug the page was rendered for; the BFF compares it with the cookie and answers **409 `tenant_changed`** (no upstream call) on a mismatch, and the UI reloads. | Review Focus 2 (tenant mix-up); client input is never trusted. | a user working in two tenants at once gets a reload prompt |
| I6 | **Cookie and CSRF rules.** Only allow-listed cookies are forwarded upstream: `better-auth.*`, `__Secure-better-auth.*`, `__Host-od-device-*`. Non-GET calls to the API always carry `Origin: <APP_ORIGIN>` (Better Auth rejects a cookie-bearing non-GET without one). Three layers: (1) the BFF refuses a non-GET whose `Origin` differs from the web origin or whose `Sec-Fetch-Site` is `cross-site` (403 `bad_origin`); (2) the API gains `requireSameOrigin` (rejects a present, foreign `Origin` on a non-GET `/v1/*` call; Bearer API keys and absent `Origin` pass), closing the B1 follow-up "Origin check for tenant-less mutations"; (3) Next server actions keep their own Origin-versus-Host check. Session cookies are set by the API (`httpOnly`, `SameSite=Lax`, `Secure` in production) and replayed unchanged by the BFF; no token ever reaches JS. | The API's CSRF defence is SameSite plus a custom header; tenant-less routes had none. | a non-browser caller without `Origin` is allowed (by design) |
| I7 | **`proxy.ts` is an optimistic check only** (Next docs: not an authorisation layer): no Better Auth session cookie → redirect to `/sign-in`; `/v1`, `/api` and `/data` are excluded from page redirects (`/data` stays a 404). The real check is `getSession()` in the `(app)` layout (one `GET /v1/me` per request, `cache()`d). A 401 there clears the cookies once and redirects to `/sign-in?reason=expired` (no loop). | Review Focus 1; calling the API from `proxy` on every request is slow and wrong. | none |
| I8 | **Demo switchers go.** "View as" (`setRole`), "Device (preview)" (`setDevice`) and mock `signIn(role)` are removed; the role is the membership role, the device is the API's cookie-bound device. "Switch company" becomes the real `switchTenant`, shown only with 2+ memberships. Demo personas are seeded users who sign in normally (T6.2). `Session` keeps its shape (`signedIn`, `role`, `tenant`, `tenants`, `entitlements`); `roles` holds only the current role, and settings pages fetch `GET /v1/roles` themselves. | Real users have real roles; a switcher would be a privilege-escalation UI. | the demo needs a sign-out/sign-in to change persona |
| I9 | **`loading.tsx` never calls the API.** Today several `loading.tsx` files read mock JSON to size the skeleton (dashboard, `/tasks`, detail masks). With a network behind them the fallback would no longer be instant. They now render the typical-counts skeleton (the one already used for an unknown id): fixed page size rows, default note wrapping, `SkMask` over a typical record. Skeleton heights are re-measured per `architecture.md` Skeletons step 5. A static test forbids imports of `**/api.ts`, `lib/api/*` and `lib/data` in `loading.tsx` files. | An instant fallback is the point of a skeleton. | a small layout jump when a list is shorter than the page size |
| I10 | **Mutations: optimistic, versioned, server wins.** Every task and report write sends the DTO `version` (D4); `409 version_conflict` → refetch, toast "Changed by someone else", the UI shows the server record; `409 retry` → repeat the same request once; `401 session_expired` → sign-in; `402 billing_required` → read-only banner; `403 module_not_entitled` → the "not in your plan" state. Optimistic state uses `useOptimistic` plus `router.refresh()`; a failure reverts by construction. An in-flight guard sends one request per action (double click). Problem bodies are mapped to short copy by `userMessage(err)` (a code table); the raw `title` and server text are never shown, only a small "Ref <requestId>" line. | Review Focus 3; no state library needed. | stale-then-corrected flicker on a conflict |
| I11 | **Ids and refs.** The FE `Task` keeps `ref` for display and URLs (`/tasks/TSK-1042`) and gains `id` (uuid) and `version`; every write uses the uuid (D2). The detail route resolves `ref` through `GET /v1/tasks?ref=` then `GET /v1/tasks/{id}`. `seriesId` is the DTO uuid, kept **opaque** (the FE only groups by it, never displays it). A missing `parentRef` (parent out of scope, B4 I4) means no parent link. Roles: the FE `Role.id` is the API `key`; the adapter keeps a key → uuid map for `PATCH /v1/members/{userId}`. People: `Person.id` is the user id. | B4 D2 and the B4/B5 B6 notes. | none |
| I12 | **Time.** The FE keeps wall strings for display (`due`, `start`, `start`/`end` of shifts) but every comparison, countdown and "overdue" test uses the instant fields (`dueAt`, `startAt`, `endAt`). A write whose date the user did not change sends the ISO instant back, never the wall string (DST fold, B4 E14); a user-edited date sends the wall string. `org.today` is the server clock formatted in the tenant zone (the mock `2026-10-20T09:00` is gone). | F3, D3, Review Focus 4. | none |
| I13 | **Recurring instances come from the API job.** The FE `materialiseRecurring` is removed from list, board, calendar and every `loading.tsx` (it would duplicate instances). Creating a repeating task is two calls (`POST /v1/tasks`, then `PUT /v1/tasks/{id}/repeat`, not atomic): if the second fails the task stays and a toast offers "Set repeat again". | B4 D11 and "POST /tasks takes no repeat". | a repeat set later than the save |
| I14 | **Scope is the server's.** The FE does not re-scope API data: `isAssigned` seed filters, `scopeReports`, `teamOf`-based filtering and `ME_ID` are not applied to API results (they remain only for mock features). F5 is one level (me plus direct reports); the seed copies reporting lines verbatim and prints the indirect pairs, and smoke and e2e expectations for team managers follow F5. | F5, D5, B5 mandatory item "Report scope". | a demo manager sees fewer reports than the mock showed |
| I15 | **No feature depends on mock-only behaviour once switched:** `lib/task-inbox.ts`, `lib/task-notices.ts`, `lib/audit-outbox.ts`, `hooks/use-notify-feed.ts`, `lib/notify-data.ts`, `features/{tasks,reports,audit,settings,account}/store.ts`, `hooks/use-shifts.ts`, `hooks/use-support-access.ts`, `hooks/use-branding.ts`, `lib/device-session.ts` mock cookies, `lib/shifts-data.ts`, `lib/shift-reports-data.ts`, `lib/today-data.ts` are deleted or rewritten in their owning task. `lib/store.ts` (`createStore`) stays: mock features use it. | Review Focus 5. | none |
| I16 | **FE-only features stay on mock data, isolated.** Mock list: rosters (M1A), staff-rosters, orders and stock, recruitment, payroll issues, files (employee docs, client files), the manager-attention **page** (decide and outstanding, G1), the AI assistant, tenant-default notification settings and delivery log, platform plans, invoice ledger, usage, notes, change-plan and schedule-deletion. Each keeps its `api.ts`/`store.ts` with a `// MOCK: no backend until <phase>` header and is listed in `lib/mock-registry.ts`. **`mockEnabled()` (server env `ENABLE_MOCK_MODULES=1`, set only on demo deployments) gates them**: unset, the page shows the existing "not available yet" state and the nav entry is hidden, so a real client never sees fake data. `test/mock-isolation.test.ts` fails if `getData(` or `lib/data` is imported outside the registry. | Fake records shown to a real client are worse than a missing page. | the first client does not see the extra modules until B8/B11 |
| I17 | **The M1A roster overlay is dropped.** `lib/shifts-data.ts#getShiftState` merged published mock roster shifts into shifts and reports (D3). With real shifts it would inject mock patterns into real reports, so the API's shifts are used as they are until B8. | B5 has no rosters. | the demo roster does not feed reports until B8 |
| I18 | **Attention.** The dashboard card, the bell and Today use `/v1/dashboard`, `/v1/attention` and `/v1/today` (the FR-M1-79 feed). The `/manager-attention` page (decide, outstanding, carry-forward) stays mock (G1) and is gated by I16. | F17, G1. | dashboard counts and the mock page differ in the demo |
| I19 | **Search.** ⌘K keeps its UI. Nav pages, quick actions and popular terms stay local; data hits come from `GET /v1/search?q=` (debounced 150 ms, 2+ characters, previous request aborted) mapped to `SearchItem` (`href` from entity and id; `dept`, `owner`, `status`, `date` empty); mock-backed kinds come from the mock index only when `mockEnabled()`. A hit without facets is dropped when a facet filter is set (documented). | `Hit` has only entity, id, title, module (B2). | filters hide API hits until B11 adds facets |
| I20 | **Billing and plan.** Billing page: `GET /v1/billing/subscription`, `/invoices`, `/v1/entitlements`; checkout, portal, cancel, resume and seats via the client; a returned `url` is followed with `location.assign`. `GET /v1/entitlements` is never cached by the app (60 s is the API's). `billingState: "blocked"` makes the session read-only through the existing `canWriteFor` path plus a persistent banner; `grace` shows a warning with the end date. Plan cards and the sign-up plan step keep reading the static `billing/plans.json`, the single source for display; a contract test asserts the `plans` table equals it (B3 "plans.json and the plans table can drift"). | C10, C13, C2 and the 402/403 contract. | a plan edit needs a file change and a seed |
| I21 | **Sessions without tokens.** The BFF returns 404 for `/api/auth/list-sessions` (it returns raw session tokens, B1 follow-up). The API adds `GET /v1/me/sessions` (id, user agent label, created, last seen, `current`; no token, no IP) and `DELETE /v1/me/sessions/{id}` (own sessions only, other ids 404). The Security tab shows device label and last active; the mock "location" column is dropped (no GeoIP) and the activity list is the last five sign-ins. | Contract-forced UI change, no leak. | no location text |
| I22 | **One MFA contract at the web boundary.** Tenant routes answer 401 `mfa_challenge` / `mfa_enrolment_required`; `/api/auth/*` answers 403 `mfa_required` (R27). `classifyApiError()` maps all three to `mfa_challenge` or `mfa_enrolment` so the UI has one state each; the API shapes are unchanged. | B1 follow-up "unify the MFA error contract before web wiring". | two shapes persist server-side |
| I23 | **Auth gaps closed in the API (small, tested).** (a) Password reset: `sendResetPassword` via the mailer, generic answer for unknown emails, token single use and 1 h, other sessions revoked, token never logged; new pages `/reset-password`. (b) `/verify-email` verifies **only after a click** (a mail scanner must not consume the token, B1 follow-up). (c) `GET /v1/auth/providers` (`{ google, microsoft }` booleans, unauthenticated) so the sign-in page shows only configured social buttons. (d) `GET /v1/me` gains `user.name`, `emailVerified`, `twoFactorEnabled`, `platformRole`. (e) `GET /v1/me/tenant` gains `brand.primaryColor`, `reportDeadline`, `reportDueAfterMinutes`, `device` and `features.drive`, evaluated per request, because staff cannot read settings and the FE needs the brand, the deadline, the current device and Drive availability. | Each is something the existing UI shows that the API cannot answer yet. | five small API additions with tests |
| I24 | **Device enrolment UI.** The mock "current device" switcher becomes a read-only chip in the shell ("Company PC", "Unregistered browser") from `me/tenant.device`; Account → Security gets a compact "This device" row with "Enter code" (`POST /v1/devices/{id}/bind`); Settings → Devices gets "Enrolment code" and "Reset" (`POST /v1/devices/{id}/enrolment-code`) and Remove (new `DELETE /v1/devices/{id}`, retire: audited, binding dropped). The `__Host-od-device-*` cookie set by the bind passes through the BFF unchanged. Drive stripping is done by the API; the FE `withholdDriveLinks` is no longer applied to API data. | CR-02, CR-06, R28; the FE had no way to bind. | none |
| I25 | **Invites and users.** The API adds `GET /v1/invites` (pending), `DELETE /v1/invites/{id}` and `POST /v1/invites/{id}/resend` (rotates the token), and accept re-validates the inviter and role (B1 follow-up). The users panel maps `people` plus invites. | The FE has Resend and Revoke. | none |
| I26 | **Template and team rename.** The report template stays keyed by team name; renaming a team (`PATCH /v1/teams/{id}`) rewrites the matching template `dept` in the same transaction, so a rename can no longer silently change which template applies (B5 mandatory item; the full move to team ids waits for B8). | Smallest safe fix for the silent change. | renaming a team writes a settings row |
| I27 | **Export.** `features/reports/export-rows.ts` becomes a re-export of `@opsdesk/domain/report-export` (one builder) with a parity test; the browser-side PDF/Excel generation for API data is replaced by `POST /v1/report-exports` and a poll of `GET /v1/report-exports/{id}`; status `expired` is in the FE enum and shows "Expired, export again". | B5 mandatory (drift, `expired`). | PDF stays Latin-1 (B5 limitation) |
| I28 | **Seed.** `api/scripts/seed-demo.ts` writes the demo tenants through the Drizzle schema inside `withTenant` (so RLS applies), hashes passwords with Better Auth's own hasher, preserves task refs and counters, **re-anchors every date** so the mock's frozen `2026-10-20T09:00` becomes the run date (same day offset, local wall time kept across DST), and ends with an invariant check. Emails use the reserved domain `demo.example` (never a real mailbox), the password comes only from `SEED_DEMO_PASSWORD` (12+ chars, never printed), the mailer is a no-op. It **refuses** `NODE_ENV=production` without `ALLOW_DEMO_SEED=1`, and refuses any database that holds a tenant outside the demo slugs. | Demo parity without secrets or risk to real data. | a different overdue count if the anchor drifts across midnight |
| I29 | **Tests.** Pure adapters have ordinary Vitest unit tests (default `npx vitest run`, no Docker). **Contract tests** live in root `test/contract/` with `vitest.contract.config.ts` and `npm run test:contract`: they boot the API in-process through `api/test/harness` (Testcontainers Postgres and Redis), seed with the factories, call the real routes, validate each response against the route's strict zod schema, then pass it through the real adapter. They are excluded from the default run and run in CI with Docker. | "mapping a real API response" needs the real API. | one more CI job |
| I30 | **e2e stack.** `docker-compose.dev.yml` (`postgres`, `redis`, `minio`, `clamav`, `mailpit`; ClamAV needs about 2 minutes) is started with `--wait`; the API runs with `NODE_ENV=development` (non-Secure cookies, S3 env fallback) and `CLAMD_HOST`; the web is `next build && next start`; the database is migrated and seeded in `globalSetup`. Playwright `webServer` starts the API and the web. Browser uploads go straight to MinIO/R2 by presigned PUT, so the bucket needs a CORS rule for the web origin (PUT, `Content-Type`). | Real scanner and real storage prove CR-05. | a slow CI job (about 6 minutes) |

## Global Constraints

- All B0–B5 constraints hold: problem+json everywhere (the UI shows short mapped copy, never `title` or server text); cross-tenant id → 404; module not in plan → 403 `module_not_entitled`; unpaid → 402 `billing_required` on non-GET; `409 retry` repeats once; `deps.clock` only on the API side.
- **No secrets or tokens in a client bundle.** `API_URL`, `APP_ORIGIN`, `SEED_*` are server env; nothing the browser needs is `NEXT_PUBLIC_*`. `scripts/check-bundle.mjs` greps `.next/static` after build for the `API_URL` value, `odk_`, `BETTER_AUTH_SECRET`, `sk_live`, `sk_test`, `whsec_`.
- The session cookie is never readable by JS and never logged; `Set-Cookie` headers are forwarded one by one, unchanged; error bodies from the API pass through as is, an unreachable or non-problem upstream becomes a generic `502 upstream_unavailable` problem with a fresh request id (no upstream text).
- Never hard-code tenant values: timezone, currency, locale, brand, departments, deadline come from the tenant (`me/tenant`, settings, teams). The seed is the only place that knows the demo's values.
- UI rules: OpsDesk theme, borderless, big radius, tokens, no shadcn defaults, motion per `ui-rules.md`. No redesign. Every new page or component (`/verify-email`, `/reset-password`, `/settings/support-access`, "This device" row, enrolment dialog, banners) gets an exact-match skeleton in `features/<f>/components/skeletons.tsx` plus `loading.tsx` where it is a route, built with `Sk` and the real classes; changed components update their skeletons in the same change.
- Short copy, icons and numbers over text (standing preference). Every switched feature keeps its states: loading skeleton, empty, error (one `ErrorState` per route segment with retry), read-only, permission-hidden.
- Features do not import each other; shared code goes in `lib/`, `hooks/`, `components/`. `features/<f>/index.ts` stays the only entry. `lib/api/*` is shared infrastructure.
- Mock features (I16) keep working untouched in a demo deployment; nothing in this phase edits their data model.
- The default `npx vitest run` (hundreds of tests) stays green after every task, plus `npx tsc --noEmit`, `npx eslint .`, `npm run build`; API suites stay green after each API addition (`npm -w api test`, isolation walker with `ROUTE_PARAMS`/`SPECS` for every new path-param route: `DELETE /v1/me/sessions/{id}`, `/v1/invites/{id}`, `/v1/invites/{id}/resend`, `DELETE /v1/devices/{id}`).
- New API additions follow B1–B5 rules: R8 RLS template on any new table (none expected), every JSON body has `.openapi({ example })`, audit for security-relevant writes, `.claude/docs/features/*.md` Backend notes updated.

## Review Focus (the five most likely real failures)

1. **Stale or invalid session cookie** — the cookie is present but the session is gone (idle 12 h, revoked, password reset elsewhere): `proxy.ts` lets the request in, every call 401s, and the user sees a half-rendered shell, a redirect loop, or keeps a dead `od-tenant`. Expected: one `GET /v1/me` per request; a 401 clears the cookies once and lands on `/sign-in?reason=expired`; a 401 during a client mutation toasts and redirects once. Tests: T6.3 `expired session redirects once, no loop`, `cookie present but invalid is not authorisation`, `client mutation 401 redirects`.
2. **Tenant mix-up** — a user with two memberships switches tenant in tab A, then saves a task in tab B (or the cookie names a tenant the user left): the write lands in the wrong tenant, or a forged `x-tenant` header is trusted. Expected: server-derived header, `x-od-tenant` consistency check, API membership check. Tests: T6.1 `bff drops x-tenant and uses the cookie`, `stale x-od-tenant → 409 tenant_changed, no upstream call`; T6.3 `switchTenant rejects a slug outside /v1/me`, `removed membership falls back to the next one or onboarding`.
3. **Optimistic update diverges from the server** — the UI shows Done, the API answers 409 `evidence_not_ready`, 403 `self_verification`, 409 `version_conflict` or 402, and the screen keeps the lie; or two quick clicks send two requests. Expected: rollback by construction, the server record wins, one request per action. Tests: T6.6 `optimistic change rolls back on every refusal and equals the DTO on success`, `version_conflict refetches`, `double click sends one request`; T6.7 `submit retry reuses the requestId`.
4. **A mismatched DTO silently shows wrong data** — a renamed field becomes `undefined` and a count shows 0, `catchall` hides a missing report key, a wall time is compared across the repeated DST hour, `parentRef` is absent, `seriesId` is treated as a ref, a stale `due` is sent back and moves a task an hour. Expected: strict response schemas, adapters that throw on a missing required field (never default silently), instants for comparisons. Tests: T6.1 `ReportSchema is strict`, contract tests per feature (T6.4 to T6.8) validate real responses against the zod schema and map them with no `undefined` in the FE object, T6.6 `unchanged date sends the ISO instant (25 Oct 01:30)`, T6.7 `countdown uses dueAt across the repeated hour`.
5. **A flow that only worked on mock behaviour** — client-side recurring instances duplicate the API's, `mergeIncoming` re-adds report-driven updates, `ME_ID` or `isAssigned` hides real tasks, a `loading.tsx` still reads JSON, a demo switcher still changes the role, a mock page shows fake data to a real client. Expected: none of those paths exist. Tests: T6.9 `mock-isolation` (no `getData` outside the registry, no `ME_ID` in switched features, no `materialiseRecurring` in routes), `loading.tsx imports no data layer`, `mock pages are unavailable when ENABLE_MOCK_MODULES is unset`, T6.6 `a series with API instances shows each once`.

---

## File structure

```
api/
  scripts/dump-openapi.ts                 # stub-deps app → OpenAPI 3.1 JSON (stdout)
  scripts/seed-demo.ts  src/seed/demo/{index,anchor,people,settings,billing,tasks,shifts,reports,devices,verify}.ts (+ tests)
  src/core/middleware/origin.ts           # requireSameOrigin (I6)
  src/modules/auth/{reset-password.ts,providers-route.ts}      # I23
  src/modules/tenants/{routes.ts,me.ts}   # /v1/me, /v1/me/tenant typed + additions
  src/modules/devices/routes.ts           # DELETE /v1/devices/{id}
  src/modules/invites/routes.ts           # list, revoke, resend, accept revalidation
  src/modules/me/sessions.ts              # GET/DELETE /v1/me/sessions
  src/modules/{tasks,shift-reports,rbac}/dto.ts   # typed DTOs (T6.1); views.ts null parentId (E15)
  src/modules/teams/service.ts            # rename carries the report template (I26)
lib/api/{schema.d.ts(generated),client.ts,problem.ts,server.ts,browser.ts,bff.ts,cookies.ts,tenant.ts}
lib/{auth-client.ts,session.ts,tenant-cookie.ts,org.ts,people.ts,entitlements-data.ts,mock-registry.ts}   # rewritten onto the API
app/v1/[...path]/route.ts  app/api/auth/[...path]/route.ts
app/actions/session.ts                    # signOut, switchTenant, afterSignIn (demo setters removed)
app/(auth)/{verify-email,reset-password}/{page,loading}.tsx
app/(app)/settings/support-access/{page,loading}.tsx
proxy.ts  next.config.ts  .env.example  Dockerfile (API_URL, APP_ORIGIN)
features/<f>/{api.ts,adapters.ts,adapters.test.ts,client.ts}   # per switched feature; store.ts deleted where I15 says
hooks/use-api-action.ts                   # in-flight guard + useOptimistic helper + error mapping
test/contract/{harness.ts,*.test.ts}  vitest.contract.config.ts  test/mock-isolation.test.ts
e2e/{global-setup.ts,fixtures.ts,cr01.spec.ts … cr06.spec.ts}  playwright.config.ts
scripts/{smoke.mjs (real login),check-bundle.mjs}
.github/workflows/ci.yml                  # api:types:check, contract, e2e jobs
.claude/docs/{architecture.md,features/*.md,deploy/}  # Data layer section, Backend notes, env + CORS + runbook
```

## Interfaces locked by this plan

```ts
// lib/api/problem.ts
class ApiError extends Error { status: number; code: string; requestId: string; extra: Record<string, unknown> }
type ErrorKind = "unauthenticated" | "session_expired" | "mfa_challenge" | "mfa_enrolment" | "email_not_verified" | "billing_required"
  | "module_not_entitled" | "forbidden" | "not_found" | "version_conflict" | "retry" | "tenant_changed" | "validation" | "unprocessable" | "rate_limited" | "upstream" | "network"
classifyApiError(e: unknown): { kind: ErrorKind; code: string }          // I22 lives here
userMessage(e: unknown): { text: string; ref: string | null }              // code table → short copy; ref = requestId

// lib/api/client.ts  (generic over the generated `paths`; both servers and browser use it)
type ApiClient = { get<P extends GetPaths>(path: P, o?: Req<P, "get">): Promise<Res<P, "get">>; post/put/patch/delete likewise }   // throws ApiError
makeApiClient(o: { baseUrl: string; fetch?: typeof fetch; headers?: () => Promise<Headers> }): ApiClient   // `fetch` injection = contract tests call app.request

// lib/api/server.ts  ("server-only")
apiServer(): Promise<ApiClient>   // reads cookies()/headers(): allow-listed Cookie, X-Tenant from od-tenant, Origin on non-GET, X-Request-Id, cache "no-store"
// lib/api/browser.ts
apiBrowser: ApiClient              // same-origin /v1, credentials same-origin, x-od-tenant = page tenant, in-flight guard helper in hooks/use-api-action.ts
// lib/api/bff.ts
forwardToApi(req: Request, o: { prefix: "/v1" | "/api/auth"; deny?: RegExp }): Promise<Response>
// lib/tenant-cookie.ts
TENANT_COOKIE = "od-tenant"; readTenantSlug(): Promise<string | null>     // httpOnly, sameSite lax, secure in production, path /

// lib/session.ts  (server-only, React cache(): one /v1/me + /v1/me/tenant + /v1/entitlements per request)
getSession(): Promise<Session>          // signedIn:false only when no session; throws redirect() for expired/no-membership
type Session = { signedIn: boolean; role: Role; roles: Role[]; tenant: Tenant; tenants: Tenant[]; entitlements: TenantEntitlements
  user: { id: string; email: string; name: string }; tenantSlug: string; billingState: "ok" | "grace" | "blocked"; device: { id: string | null; label: string; trusted: boolean }; drive: boolean }

// app/actions/session.ts ("use server")
switchTenant(slug: string): Promise<void>; signOutAction(): Promise<void>; afterSignIn(): Promise<void>   // picks od-tenant, redirects / or /platform

// lib/auth-client.ts (browser; typed over FE Zod schemas, paths pinned by contract tests)
signInEmail(b): Promise<{ twoFactorRedirect?: true }>; signUpEmail(b); verifyEmail(token); resendVerification(email); requestPasswordReset(email); resetPassword(token, pw)
verifyTotp(code, o?); verifyBackupCode(code); enableTotp(pw); disableTotp(pw); getTotpUri(pw); generateBackupCodes(pw); signOut()

// lib/mock-registry.ts
MOCK_FEATURES: readonly { feature: string; owner: "B8" | "B9" | "B10" | "B11" | "B3"; files: string[] }[]
mockEnabled(): boolean              // process.env.ENABLE_MOCK_MODULES === "1"  (server only)
```

```ts
// api additions (all in the generated schema after T6.1/T6.3/T6.5)
GET  /v1/me                     → { user: { id, email, name, emailVerified, twoFactorEnabled }, platformRole: string | null, tenants: { slug, name, roleKey }[] }
GET  /v1/me/tenant              → { tenant: {...}, member: {...}, brand: { primaryColor: string | null }, reportDeadline: string, reportDueAfterMinutes: number, device: { id: string | null; type: string; label: string; trusted: boolean }, features: { drive: boolean } }
GET  /v1/me/sessions            → { items: { id, label, createdAt, lastSeenAt, current }[] }       DELETE /v1/me/sessions/{id} → 204 | 404
GET  /v1/auth/providers         → { google: boolean; microsoft: boolean }
GET  /v1/invites → { items: { id, email, roleKey, expiresAt, invitedBy }[] }   DELETE /v1/invites/{id} → 204   POST /v1/invites/{id}/resend → 200
DELETE /v1/devices/{id}         → 204 (retire; settings:write; audited device.retired)
requireSameOrigin: non-GET /v1/*, present foreign Origin → 403 bad_origin (Bearer odk_ keys exempt)
```

### Error code → UI (single table in `lib/api/problem.ts`, one test per row)

| Status and code | Kind | UI |
|---|---|---|
| 401 `unauthenticated`, `session_expired` | session_expired | clear cookies, `/sign-in?reason=expired` (once) |
| 401 `mfa_challenge`, 403 `mfa_required` | mfa_challenge | MFA step (sign-in) or step-up dialog |
| 401 `mfa_enrolment_required` | mfa_enrolment | `MfaGate` (AC-M0-02) |
| 403 `email_not_verified` | email_not_verified | "Verify your email" with resend |
| 402 `billing_required` | billing_required | read-only banner, write buttons disabled |
| 403 `module_not_entitled` | module_not_entitled | "Not in your plan" state |
| 403 `device_policy` | forbidden | "Available on your work PC" |
| 403 other, 404 | forbidden, not_found | route `not-found` / toast |
| 409 `version_conflict` | version_conflict | refetch + toast |
| 409 `retry` | retry | repeat once |
| 409 `tenant_changed` (BFF) | tenant_changed | reload the page |
| 400, 422 | validation, unprocessable | field errors from `errors[]` or one toast |
| 429 | rate_limited | "Too many attempts, wait a minute" |
| 502, network | upstream, network | `ErrorState` with retry; a queued write is never auto-replayed |

### Feature → backing map

| Feature | Routes (module) | Mock files today | Adapter notes | Task |
|---|---|---|---|---|
| shell, session, org, people | `/v1/me`, `/v1/me/tenant`, `/v1/people`, `/v1/teams`, `/v1/entitlements` | `shell/*`, `tasks/people.json`, `settings/users.json` | role key as id; avatar class from a stable hash of the user id; `org.today` from the server clock | T6.3, T6.4 |
| auth | Better Auth, `/v1/tenants`, `/v1/invites/accept`, `/v1/auth/providers` | `auth/onboarding-defaults.json` | plans static (I20); onboarding creates the tenant | T6.3 |
| billing | `/v1/billing/*`, `/v1/entitlements` | `billing/*` | plans static; 402/403 states | T6.4 |
| notifications bell | `/v1/notifications*` | `shell/notifications.json` | poll 60 s while visible | T6.4 |
| settings, account | `/v1/settings/*`, `/v1/roles`, `/v1/members`, `/v1/teams`, `/v1/invites`, `/v1/devices*`, `/v1/device-policies*`, `/v1/integrations`, `/v1/data-requests`, `/v1/me/*` | `settings/*`, `account/*` | tenant-default notifications and delivery log stay mock (I16) | T6.5 |
| audit | `/v1/audit`, `/v1/audit/export` | `audit/events.json` | action catalogue test (T6.5) | T6.5 |
| search | `/v1/search` | `search/*` | I19 | T6.5 |
| tasks, projects, templates, evidence, voice | `/v1/tasks*`, `/v1/projects*`, `/v1/task-templates*`, `/v1/evidence*` | `tasks/*` | I11, I12, I13 | T6.6 |
| shifts, reports, template, export | `/v1/shifts*`, `/v1/shift-reports*`, `/v1/report-exports*` | `shifts/*`, `reports/*`, `settings/template.json` | I12, I14, I27 | T6.7 |
| dashboard, Today, attention feed | `/v1/dashboard*`, `/v1/today*`, `/v1/attention` | `dashboard/*`, `attention/*` | I18 | T6.7 |
| platform console | `/v1/platform/*`, `/v1/settings/support-grants` | `platform/*` | coverage table first (T6.8) | T6.8 |
| rosters, staff-rosters, orders, recruitment, payroll, files (docs, clients), assistant, manager-attention page | none | their JSON | I16 | T6.9 gate |

---

### Task T6.1: Contract and transport: generated types, typed DTOs, API clients, BFF, tenant and cookie rules — **security-sensitive: strongest reviewer**

**Files:**
- `api/scripts/dump-openapi.ts`; root `package.json` scripts `api:types` (dump then `openapi-typescript` into `lib/api/schema.d.ts`), `api:types:check` (regenerate to a temp file and diff), `test:contract`; `.github/workflows/ci.yml` steps. Add `openapi-typescript` as a pinned devDependency; run `npm audit --audit-level=high`.
- API: `core/middleware/origin.ts` (`requireSameOrigin`, mounted on `/v1/*` in `app.ts`), `modules/tenants/{routes,me}.ts` (typed `/v1/me`, `/v1/me/tenant` with `name`, `emailVerified`, `twoFactorEnabled`, `platformRole`, `brand`, `device`, `features.drive`), `modules/tasks/dto.ts` (typed `checklist`, `subtasks`, `notes`, `evidence`, `timeEntries`, `proposal`, `repeat`, `voiceNote`), `modules/shift-reports/dto.ts` (`ReportSchema` becomes a strict object with the `ReportDto` fields, no `catchall`, no `z.any()`), `modules/rbac/routes.ts` (access values `none|read|write`).
- Web: `lib/api/{client,problem,server,browser,bff,cookies,tenant}.ts`, `app/v1/[...path]/route.ts`, `app/api/auth/[...path]/route.ts`, `lib/tenant-cookie.ts`, `proxy.ts` matcher (excludes `v1`, keeps `/data` 404), `.env.example` (`API_URL`, `APP_ORIGIN`), `Dockerfile` env, `test/contract/{harness.ts,smoke.test.ts}`, `vitest.contract.config.ts`, `vitest.config.ts` (default run excludes `test/contract/**`), `scripts/check-bundle.mjs`, `architecture.md` "Data layer" section.

**Interfaces:** `ApiClient`, `makeApiClient`, `apiServer`, `apiBrowser`, `forwardToApi`, `classifyApiError`, `userMessage` (see above). BFF rules: path must match `^/v1/` (or `^/api/auth/`) after URL normalisation (no `..`, no encoded dots, no `//`), methods GET POST PUT PATCH DELETE; request headers dropped: `x-tenant`, `authorization`, `cookie` (rebuilt from the allow-list), `host`, `x-forwarded-*` except the proxy's `x-forwarded-for`, every `x-od-*`; `redirect: "manual"` (a presigned 302 reaches the browser); body streamed with a 2 MiB cap for JSON (413 above; uploads go to storage); 30 s timeout; `Set-Cookie` copied one by one; upstream failure → `502 upstream_unavailable` problem+json with a new request id.

- [ ] **Step 1: Failing tests**

API (`api/src/...`):
```ts
test("requireSameOrigin: a cookie POST with a foreign Origin → 403 bad_origin; same Origin, no Origin, and a Bearer odk_ key pass; GET is never checked", async () => {})
test("GET /v1/me returns user name, emailVerified, twoFactorEnabled and platformRole (null for members, the staff role for staff)", async () => {})
test("GET /v1/me/tenant is typed and carries brand.primaryColor, reportDeadline, reportDueAfterMinutes, device and features.drive; drive is false on an unregistered browser and true on the bound company PC, evaluated per request", async () => {})
test("OpenAPI has no untyped 2xx JSON response: walk the document, fail on an empty schema or z.any (allow-list: audit before/after, platform audit before/after)", async () => {})
test("TaskDto parses a real task with checklist, notes, evidence, time entries, proposal, repeat and voice note", async () => {})
test("ReportSchema is strict: a real report from the harness parses; an unknown key fails; items, attachments, comments and extra are typed", async () => {})
test("RoleDto.access only allows none|read|write", async () => {})
```
Web (`lib/api/*.test.ts`, `app/v1/route.test.ts`, fake `fetch`):
```ts
test("bff drops x-tenant, authorization and x-od-* from the browser and sets x-tenant from the od-tenant cookie", async () => {})
test("bff forwards only better-auth, __Secure-better-auth and __Host-od-device cookies; od-tenant and anything else stay home", async () => {})
test("bff: stale x-od-tenant (page tenant ≠ cookie) → 409 tenant_changed and no upstream call", async () => {})
test("bff rejects a non-GET with a foreign Origin or Sec-Fetch-Site cross-site → 403 bad_origin; a same-origin POST passes; a GET without Origin passes", async () => {})
test("bff refuses paths outside /v1/ and /api/auth/: /healthz, /v1/../healthz, %2e%2e, //evil, /webhooks/billing/stripe", async () => {})
test("bff does not follow redirects: a 302 to a presigned URL and the Google callback 302 reach the browser", async () => {})
test("bff copies several Set-Cookie headers separately and unchanged (httpOnly, SameSite, Secure, __Host- prefix intact)", async () => {})
test("bff maps an unreachable upstream, a 502 and a non-problem 500 to 502 upstream_unavailable problem+json with no upstream text and a fresh request id; a real problem body passes through untouched", async () => {})
test("bff caps a JSON body at 2 MiB (413) and times out after 30 s", async () => {})
test("apiServer sets Origin on POST/PUT/PATCH/DELETE, never forwards a client x-tenant, and uses cache no-store", async () => {})
test("classifyApiError and userMessage: one assertion per row of the error table; userMessage never returns the raw title or server text, ref is the requestId", async () => {})
test("generated types are current: api:types:check passes; a changed DTO makes it fail", async () => {})
test("no secret in the client bundle: check-bundle.mjs finds none of API_URL, odk_, BETTER_AUTH_SECRET, sk_live, sk_test, whsec_ in .next/static", async () => {})
```
Contract harness (`test/contract/smoke.test.ts`, **runs against the real API in the Testcontainers harness**):
```ts
test("makeApiClient with fetch = app.request: sign up, verify through the captured mail, sign in, GET /v1/me, create a tenant, GET /v1/me/tenant and /v1/entitlements all parse against their zod schemas", async () => {})
test("lib/auth-client wrappers match the real Better Auth paths and bodies: sign-up, sign-in, verify-email, forgot/reset password, two-factor enable/verify, sign-out", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement (strict schemas first, then dump and generate the types, then clients, BFF, tenant cookie). Run `npm -w api test`, root `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `node scripts/check-bundle.mjs`. Commit `feat(web): typed API client from OpenAPI, same-origin BFF, tenant cookie and CSRF rules`.

---

### Task T6.2: Demo seed: `public/data/**/*.json` → Postgres — **never against production: strongest reviewer on the guards**

**Files:** `api/scripts/seed-demo.ts`, `api/src/seed/demo/*.ts` and tests, `api/package.json` (`seed:demo`), `api/Dockerfile` (copy all of `public/data`, it is not secret), `docker-compose` docs, `.claude/docs/deploy/demo-seed.md`.

**Interfaces:**
```ts
// npm -w api run seed:demo -- [--reset] [--anchor 2026-12-01]
seedDemo(db: Db, o: { clock: Clock; password: string; anchor?: string; sourceDir: string; emailDomain?: string }): Promise<SeedReport>
type SeedReport = { tenants: string[]; users: number; counts: Record<string, number>; indirectReports: [manager: string, member: string][]; warnings: string[] }
// env: DATABASE_URL (app_user), DATABASE_OWNER_URL, SEED_DEMO_PASSWORD (12+ chars, required), SEED_EMAIL_DOMAIN (default demo.example), SEED_PLATFORM_TOTP_SECRET (optional), ALLOW_DEMO_SEED (required when NODE_ENV=production)
```
Mapping: `shell/tenants.json` + `billing/subscription.json` → three tenants (`t1` Northgate business active with the full dataset, `t2` Harbourline starter trial, `t3` Millbrook business past_due, owners only); `settings/users.json` (14) and `tasks/people.json` (11) → users matched by name (unmatched people get a synthetic `<slug>@demo.example`), `shell/roles.json` role keys → memberships, `shifts/members.json` → teams, reporting lines and members; `shifts/*` → patterns, assignments, reporting; `tasks/{tasks,projects,templates}.json` → tasks (refs and per-tenant counter preserved, history from `timeline`, evidence, checklist, repeat series), `reports/reports.json` → reports with frozen snapshots; `settings/devices.json` → devices, registered but **unbound** (no binding secret is seeded; a persona is "on the company PC" only after the enrolment flow, which e2e runs); `settings/{organisation,template,holidays}.json`; `shell/org.json` → tenant timezone, currency, locale, deadline. Not seeded (I16): rosters, staff-rosters, orders, recruitment, payroll, files, assistant, platform plans and invoices.

- [ ] **Step 1: Failing tests** (`api/src/seed/demo/*.test.ts`, Testcontainers)
```ts
test("seed is idempotent: two runs give identical row counts, no duplicate users, same refs and ids by natural key", async () => {})
test("row counts equal the JSON: users, memberships, teams, patterns, assignments, tasks, reports, devices, projects, templates (the totals smoke asserts)", async () => {})
test("dates re-anchor: with --anchor 2026-12-01 the overdue, due-today and submitted counts equal the mock's at 2026-10-20; wall times keep their local value across the 25 Oct DST end; reports keep their shift dates relative to the anchor", async () => {})
test("task refs are preserved (TSK-1042 exists) and the next created task gets TSK-<max+1>", async () => {})
test("every seeded persona signs in through Better Auth with SEED_DEMO_PASSWORD: email verified, no 2FA, role key as in roles.json; the platform owner exists only when SEED_PLATFORM_TOTP_SECRET is set and then has 2FA enrolled with it", async () => {})
test("emails use the reserved domain; the seed sends no mail (mailer is a no-op) and no notification email is queued", async () => {})
test("guards: NODE_ENV=production without ALLOW_DEMO_SEED=1 refuses; a database with a tenant slug outside the demo set refuses; a missing or short SEED_DEMO_PASSWORD refuses; the password never appears in stdout, stderr or the report", async () => {})
test("reporting lines are copied verbatim and indirectReports lists every manager-of-manager pair (F5 note)", async () => {})
test("after seeding: the RLS guard passes, verifyChain is ok for every tenant, GET /v1/search finds a seeded task by ref, entitlements are business / starter trialing / business past_due", async () => {})
test("plans table equals public/data/billing/plans.json (single source of plan data)", async () => {})
test("--reset deletes only the demo tenants and their users, never any other tenant", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Run the seed twice against the compose Postgres and sign in with curl. Commit `feat(api): idempotent demo seed from the mock JSON with production guards`.

---

### Task T6.3: Auth and session: `proxy.ts`, session, sign-in, sign-up, verify, reset, MFA, device cookie, tenant switch — **security-sensitive: strongest reviewer**

**Files:** `proxy.ts`, `lib/{session,tenant-cookie,auth-client}.ts`, `app/actions/session.ts` (demo setters removed), `app/(auth)/{sign-in,sign-up,forgot-password,onboarding,verify-email,reset-password}`, `features/auth/*` (forms call `lib/auth-client`, new `VerifyEmail` and `ResetPassword` components with skeletons and `loading.tsx`), `features/account/components/{totp-setup,mfa-gate,security-panel}.tsx`, `features/shell` (remove the "View as" and "Device (preview)" items; tenant switcher real; device chip), `app/(app)/layout.tsx`, API additions `modules/auth/{reset-password,providers-route}.ts`, `modules/me/sessions.ts`, `/v1/me/tenant` device and Drive fields wired to `loadDevice`.

**Interfaces:** `getSession`, `switchTenant`, `signOutAction`, `afterSignIn`, `lib/auth-client` (see above). Sign-in: `signInEmail` → `{ twoFactorRedirect }` → MFA step (`verifyTotp`, `verifyBackupCode`) → `afterSignIn()` (reads `/v1/me`, writes `od-tenant` = first membership, redirects `/` or `/platform` when the user has no tenant membership but is staff, `/onboarding` when neither). Sign-up: `signUpEmail` → "Check your inbox"; `/verify-email?token=` shows one button "Verify", only the click calls `verifyEmail`. Onboarding: `POST /v1/tenants` (name, slug, timezone, currency, locale from the wizard defaults), optional `POST /v1/invites`; the paid-plan choice opens `POST /v1/billing/checkout` after onboarding (T6.4), the starter trial needs no call. TOTP set-up shows the secret with copy and the `otpauth://` link (no QR library, see "Decisions needed"). The old behaviour "continue as role" is gone (I8).

- [ ] **Step 1: Failing tests**

API:
```ts
test("password reset: a verified user gets one mail; an unknown email gets the same 200 and no mail; the token works once, expires in 1 h, revokes other sessions, and never appears in logs", async () => {})
test("GET /v1/auth/providers lists only providers with both id and secret", async () => {})
test("GET /v1/me/sessions never returns a token or an IP; marks the current one; DELETE /v1/me/sessions/{id} removes own sessions, another user's id → 404; walker SPECS entry", async () => {})
test("an api key cannot read or delete sessions (human only)", async () => {})
```
Web (fake fetch unless noted):
```ts
test("proxy: no better-auth cookie → redirect /sign-in for pages; /v1, /api/auth and /data are not redirected (/data → 404); with a cookie it passes and sets x-od-path and x-od-search", async () => {})
test("cookie present but invalid is not authorisation: the layout calls /v1/me, gets 401 and redirects; no data of the page is rendered", async () => {})
test("expired session redirects once to /sign-in?reason=expired and clears better-auth and od-tenant cookies; the sign-in page does not redirect again (no loop)", async () => {})
test("a client mutation that gets 401 toasts once and redirects once", async () => {})
test("getSession composes /v1/me, /v1/me/tenant, /v1/entitlements into Session with the role narrowed to the plan; one /v1/me call per request even when five components ask", async () => {})
test("switchTenant rejects a slug that is not in /v1/me and writes no cookie; accepts a member slug; od-tenant is httpOnly, sameSite lax, secure when production, path /", async () => {})
test("a removed or suspended membership (404 on the tenant) falls back to the next membership; none left → /onboarding; staff without tenant → /platform", async () => {})
test("sign-in: wrong password shows one generic message (no account enumeration); 429 shows the rate-limit copy; 403 email_not_verified shows resend; twoFactorRedirect shows the code step; a backup code works; success sets od-tenant and redirects", async () => {})
test("sign-up creates no session; verify-email calls the API only on click (rendering the page with a token calls nothing); an expired token shows a resend button", async () => {})
test("forgot password always shows the same confirmation; reset with a bad token shows one generic error", async () => {})
test("classifyApiError maps 401 mfa_challenge, 403 mfa_required and 401 mfa_enrolment_required to the two MFA kinds; the layout renders MfaGate for enrolment (AC-M0-02) and a step-up dialog for challenge", async () => {})
test("BFF returns 404 for /api/auth/list-sessions; the Security tab lists sessions from /v1/me/sessions (label, last active, no location) and 'Sign out other devices' calls revoke-other-sessions", async () => {})
test("the shell shows no 'View as' and no device switcher; a user with one membership sees no company switcher; the device chip shows the label from me/tenant.device", async () => {})
test("the bound-device cookie set by POST /v1/devices/{id}/bind reaches the browser unchanged, and server components forward it so features.drive flips", async () => {})
test("skeletons: VerifyEmail, ResetPassword and the changed sign-in step have exact skeletons; loading.tsx files exist for the new routes", async () => {})
```
Contract (**real API**): `test("sign-in, MFA enrol and verify, sign-out through lib/auth-client against the harness; tenant routes answer 401 mfa_challenge for an enrolled session until verified", async () => {})`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Walk the flows in a browser with the seeded personas (light and dark) and record the hover/disabled/open states check. Commit `feat(web): real session, Better Auth sign-in, MFA, verification and tenant switching`.

---

### Task T6.4: Shell, plan and billing: org, people, entitlements, notifications, 402 and 403 states

**Files:** `lib/{org,people,entitlements-data}.ts`, `features/shell/api.ts` (navigation stays static JSON: it is app structure, not tenant data), `features/billing/{api,adapters,client}.ts` and components (states only), `features/shell` bell (`hooks/use-notifications.ts` replaces `use-notify-feed`; delete `lib/notify-data.ts`, `lib/task-notices.ts`, `lib/audit-outbox.ts`), `components/billing-banner.tsx` (read-only and grace) with skeleton, `app/(app)/layout.tsx`.

**Interfaces:** `getOrg()` composes the tenant zone, currency and locale from `/v1/me/tenant`, `today` from the server clock in the tenant zone, departments from `GET /v1/teams?kind=department`, the report deadline from `me/tenant.reportDeadline`, so **no route needs `settings:read` for a plain member**; `Org.reminders` is dropped unless a grep finds a consumer. `getPeople()` maps `GET /v1/people` to `Person` (`id` = user id, `role` = role label, initials from the name, `avatar` = `av<1..n>` from a stable hash). `getTenantEntitlements()` maps `/v1/entitlements.modules` through the static module map `billing/entitlements.json` (structure, not tenant data). `getBilling()` = subscription + invoices + plans (static).

- [ ] **Step 1: Failing tests**
```ts
test("a staff member (no settings:read, no audit) loads the shell and the home page without a single 403", async () => {})
test("toPerson maps /v1/people: id is the user id, avatar is stable for the same id, role is the label, dept from the team; a person with no name falls back to the email local part", async () => {})
test("getOrg uses the tenant's own timezone, currency and locale (a Pacific/Auckland tenant shows Auckland today); no hard-coded Europe/Dublin", async () => {})
test("entitlements: modules ['M0','M1'] hide M1A/M4 nav entries and the API 403 module_not_entitled renders the 'Not in your plan' state; the entitlements call is never cached", async () => {})
test("billing page maps subscription, invoices and plans; checkout, portal, cancel, resume and seats call the API and follow a returned url; 422 on seats shows the message", async () => {})
test("billingState blocked: session is read-only (canWriteFor false), banner shown, a write attempt that still gets 402 shows the banner and rolls back; GET pages keep working; billing and data-export stay usable", async () => {})
test("billingState grace shows the warning with the grace end date in the tenant zone", async () => {})
test("bell: lists /v1/notifications, mark one and read-all call the API, polls every 60 s only while the tab is visible, shows task notices written by the API (no client outbox)", async () => {})
test("deleted modules: lib/notify-data, lib/task-notices and lib/audit-outbox no longer exist and nothing imports them", async () => {})
test("skeletons: billing banner and bell loading states match their components", async () => {})
```
Contract (**real API**): `test("/v1/me/tenant, /v1/people, /v1/teams, /v1/entitlements, /v1/billing/subscription, /v1/billing/invoices and /v1/notifications for an owner and a staff member parse against their zod schemas and map through the adapters with no undefined field", async () => {})`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(web): shell, plan, billing and notifications on the API`.

---

### Task T6.5: Settings, account, audit, search: M0 tenant administration

**Files:** `features/settings/{api,adapters,client}.ts` and panels (organisation, branding, departments (teams), users and invites, roles matrix, devices, device policy, mfa policy, integrations, privacy), `features/account/*` (profile, security, notification prefs, "This device" row), `features/audit/{api,adapters,client,actions-catalogue}.ts`, `features/search/{api,adapters,actions}.ts`, new `app/(app)/settings/support-access/{page,loading}.tsx` (`GET/DELETE /v1/settings/support-grants`), API additions (invites list, revoke, resend, accept revalidation; `DELETE /v1/devices/{id}`; team rename carries the template, I26). Delete `features/{settings,account,audit}/store.ts`, `hooks/use-{branding,support-access}.ts`, `lib/{device-session,support-data}.ts` mock cookies (the pure `lib/devices.ts` stays for mock reuse).

**Interfaces:** the template editor is in T6.7. The tenant-default notification settings and delivery log are mock (I16, hidden outside demo). Branding logo upload uses `/v1/files/uploads` + `complete`, shown only when the plan has the files module (starter tenants cannot upload, B3 follow-up): colour only otherwise, with a one-line hint. The audit page keeps its filters; actions come from the catalogue.

- [ ] **Step 1: Failing tests**
API:
```ts
test("GET /v1/invites lists pending invites (settings:write); DELETE revokes (audited invite.revoked); resend rotates the token and sends one mail; the old token stops working; walker SPECS for /v1/invites/{id} and /resend", async () => {})
test("invite accept re-validates the inviter's current role and the invited role; a demoted inviter's invite is refused", async () => {})
test("DELETE /v1/devices/{id} retires the device: binding dropped, audit device.retired, the old cookie answers as unregistered, other tenant's id → 404", async () => {})
test("renaming a team rewrites the matching shift-report template dept in the same tx; reports and the template still resolve for the renamed team", async () => {})
```
Web:
```ts
test("role matrix: FE Role.id is the key; changing a member's role sends the role uuid from the key map; 403 on escalation shows one toast and reverts", async () => {})
test("users panel: members plus pending invites; resend and revoke call the API and update the row; a 422 shows the message", async () => {})
test("devices panel: register, trust toggle, Remove, 'Enrolment code' shows the one-time code once and never stores it, 'Reset' clears the binding; read-only for a role without settings:write", async () => {})
test("account 'This device': Enter code binds this browser, then the chip reads the company PC and features.drive is true on the next render; a wrong code shows the generic message; five wrong codes show the locked message", async () => {})
test("device policy and mfa policy PUTs map the API shapes; a policy change shows in the audit page", async () => {})
test("departments panel: create, rename, delete; deleting a team with shifts shows team_has_shifts; renaming keeps the template (contract below)", async () => {})
test("organisation and branding save only what the API accepts; invalid colour and timezone show field errors; staff do not see the tabs they cannot read (permission-hidden)", async () => {})
test("privacy panel: request export (POST /v1/me/data-export), data-requests list, status chips; erase asks for confirmation", async () => {})
test("integrations panel: Google start follows the returned url; the callback 302 returns to settings; disconnect works", async () => {})
test("audit: list maps entries, filters by actor, action and date through the query, cursor pagination, CSV export via the download route; actions-catalogue contains every action literal recorded by the API (scan api/src for recordAudit action strings)", async () => {})
test("search: nav pages and quick actions stay local; the API hits appear grouped by type with an href per entity; facet filters drop hits without facets; two quick keystrokes abort the first request; mock kinds appear only when mockEnabled()", async () => {})
test("support-access page lists active grants and revokes one; skeleton matches; the notification link /settings/support-access resolves", async () => {})
test("settings, account, audit and search loading.tsx files import no data layer (I9); changed panels updated their skeletons", async () => {})
```
Contract (**real API**): `test("organisation, branding, holidays, teams, people, roles, members, invites, devices, device policies, mfa policy, integrations, data requests, me/sessions, me/notification-preferences, audit and search responses parse against their schemas and map through the adapters", async () => {})`, plus `test("plans table equals billing/plans.json")`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(web): settings, account, audit and search on the API`.

---

### Task T6.6: Tasks, projects, templates, evidence, voice — **optimistic writes and DTO mapping: strongest reviewer**

**Files:** `features/tasks/{api,adapters,client}.ts` and components (`task-actions`, `evidence-panel`, `task-detail`, list, board, calendar, archive, projects, new-task, templates), `app/(app)/tasks/**` (pages and `loading.tsx` per I9), `hooks/use-api-action.ts`, API `modules/tasks/views.ts` (E15: null `parentId` for an out-of-scope parent on board and calendar cards). Delete `features/tasks/store.ts`, `lib/task-inbox.ts`, FE `materialiseRecurring` use in routes; keep the pure `lifecycle.ts`, `planning.ts`, `mutations.ts` for optimistic prediction and tests.

**Interfaces:** `toTask(dto, ctx): Task` (adds `id`, `version`, keeps `ref`, `due`/`start` wall plus `dueAt`/`startAt`, `assignees` full list, `seriesId` opaque, `parentRef?`), `toTaskBody(form)`, `toPatch(prev, next)` (sends only changed fields, ISO instant for unchanged dates), `toEvidence(dto)`, `toTimeline(history)`. Writes: PATCH, assignees, status, complete, verify, reject, reschedule (preview then apply with `previewHash`, D20), dependencies, repeat, evidence rule, archive, restore, purge, checklist (absolute `done`), comments, subtasks, date proposals, voice note. Uploads: `POST /v1/tasks/{id}/uploads` → presigned PUT to storage → `…/complete` → poll until `clean` (D10); the evidence row shows "Scanning" then counts. `canVerify` call sites pass `task.assignees` (D8).

- [ ] **Step 1: Failing tests**
```ts
test("toTask maps a real DTO: id, version, ref, wall and instant dates, assignees, seriesId stays a string, a missing parentRef means no parent; a missing required field throws instead of defaulting", async () => {})
test("unchanged dates send the ISO instant back (25 Oct 2026 01:30 Dublin keeps its instant); a user-edited date sends the wall string", async () => {})
test("optimistic status change equals the DTO on success and rolls back on 403, 422, 409 evidence_not_ready, 409 version_conflict and 402; each shows the mapped copy and a Ref", async () => {})
test("409 version_conflict refetches the task and toasts 'Changed by someone else'; 409 retry repeats the identical request once", async () => {})
test("double click on Complete sends one request (in-flight guard); a failed request can be retried", async () => {})
test("canVerify call sites (task-actions, evidence-panel, task-detail) pass the full assignee list: a manager who is a co-assignee sees no Verify or Reject; the API 403 self_verification still shows if forced", async () => {})
test("create with repeat is two calls; if PUT /repeat fails the task stays and a toast offers 'Set repeat again' without creating a second task", async () => {})
test("a series with API instances shows each once: materialiseRecurring is not applied to API data", async () => {})
test("subtask of an out-of-scope parent renders without a parent link and does not crash; board and calendar cards null the parent (E15)", async () => {})
test("staff scope is the server's: no FE filter; opening another person's task ref shows the not-found page (404 task_not_found)", async () => {})
test("Drive: withheld text from the API is shown as is; the Drive evidence button is hidden when features.drive is false and the 403 device_policy case shows 'Available on your work PC'", async () => {})
test("evidence upload: PUT to the presigned URL then complete; Scanning pill until clean; an infected file shows the auto-reject reason; Complete before clean shows evidence_not_ready copy", async () => {})
test("knock-on: preview shows moves and hiddenMoves; apply sends previewHash; 409 knock_on_changed re-previews", async () => {})
test("checklist tick sends absolute done; comments send mentions as user ids; voice note upload enforces the 120 s limit client-side and maps voice_too_long", async () => {})
test("report-driven updates appear in the history as the neutral line only (H4); the member's row note is not on the task page", async () => {})
test("loading.tsx of every tasks route imports no data layer; TaskDetailLoading masks a typical record; list, board, calendar, archive and projects skeletons match their components (re-measured)", async () => {})
```
Contract (**real API**): `test("tasks list, detail by ref, board, calendar, archive, projects, templates, history, comments and evidence responses parse against the strict schemas and map through toTask with no undefined", async () => {})`, `test("create → patch (version) → status → complete → verify by a different manager works through the client wrappers; the stale version gets 409", async () => {})`, `test("ISO round trip: a task due in the repeated DST hour is patched with an unchanged date and keeps its dueAt", async () => {})`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(web): tasks, projects, templates, evidence and voice on the API`.

---

### Task T6.7: Shifts, reports, template, export, dashboard, Today — **instants, scope and idempotent submit: strongest reviewer**

**Files:** `features/{shifts,reports,dashboard}/{api,adapters,client}.ts`, components and routes (`/shifts`, `/daily-reports`, `/daily-reports/[id]`, `/` home, Today card), `features/settings/components/template-panel.tsx` (template editor on `GET/PUT /v1/shift-reports/template`), `features/reports/export-rows.ts` (shim over `@opsdesk/domain/report-export`), `features/reports/export.ts` (job client). Delete `features/reports/store.ts`, `hooks/use-shifts.ts`, `lib/{shifts-data,shift-reports-data,today-data}.ts` (the roster overlay goes, I17).

**Interfaces:** `toShiftState(dto)`, `toReport(dto)` (strict), `toReportBody(form)` (`version`, `items`, `summary`, `blockers`, `unplanned`, `extra`, `attachmentFileIds`), `toDashboard(dto)`. Draft saves are debounced (800 ms) `PUT …/draft` with `version`; Submit sends `{ version, requestId }`, the id is generated once per attempt and reused on retry (F7); virtual rows (`id: null`, a `key`) are opened with `POST /v1/shift-reports/open` first. Accept and return send `version` and a comment. Export: `POST /v1/report-exports`, poll `GET /v1/report-exports/{id}` (1 s then 2 s), open `/download` when `done`; statuses `queued|running|done|failed|expired`. Today: `GET /v1/today`; `POST /v1/today/updates { taskId, action, dayKey }` with `dayKey = workingDay.key` from that response; a 422 `invalid_day_key` refetches. The report deadline card and the dashboard widgets render from `/v1/dashboard`, `/v1/dashboard/staff`, `/v1/dashboard/team-tasks`.

- [ ] **Step 1: Failing tests**
```ts
test("toReport maps a real report: items, state, version, instants and extra answers; an unknown or missing required key throws", async () => {})
test("countdown and 'late/missing' use dueAt instants: the 24 Oct night (22:00-06:00, due 07:00) shows 07:00 in the repeated hour and never an hour early; the 27 Mar 2027 night too; a Pacific/Auckland tenant", async () => {})
test("a team manager sees me plus direct reports only (F5): no FE re-scoping, an indirect report's report is absent; the seed's indirect pairs are documented in the demo notes", async () => {})
test("draft autosave sends version and applies the returned version; two tabs: 409 version_conflict reloads the report", async () => {})
test("submit sends version + requestId; a network retry reuses the same requestId and shows one submission; a double tap sends one request; 409 report_locked shows the locked state; 422 report_invalid maps errors[] to field errors (summary, 'item:TSK-1001:note')", async () => {})
test("submit updates the member's tasks: the task page shows the neutral history line only and the row note stays in the report (H4)", async () => {})
test("virtual inbox rows (id null) open through POST /v1/shift-reports/open; reporting off (422 reporting_off) shows the off state; a missing report shows 'Missing' after the deadline", async () => {})
test("accept and return: manager-home with reports:write; a manager on their own report gets 403 self_review shown as 'You cannot review your own report'; return needs a comment", async () => {})
test("export: request → queued → running → done opens the download; failed shows the code copy; expired shows 'Expired, export again'; 422 range_too_long and export_too_large show their copy", async () => {})
test("export-rows parity: features/reports/export-rows is the domain builder (same exports, same output on the shared fixtures)", async () => {})
test("template editor: save maps the departments array; 422 shows field errors; a team rename keeps its template after reload (I26)", async () => {})
test("Today: dayKey comes from workingDay.key; Mark done sends one update; an 'evidence still needed' result shows the proof prompt; 422 invalid_day_key refetches; snooze adds only the history line", async () => {})
test("dashboard: manager and staff variants render from the DTOs; counts equal the DTO (no client recount); the awaiting-reports count excludes the caller's own submitted reports; permission-hidden cards stay out of the payload", async () => {})
test("attention: the dashboard card and bell show the FR-M1-79 feed; the /manager-attention page is the mock one and is unavailable when ENABLE_MOCK_MODULES is unset (I18)", async () => {})
test("shifts admin: patterns, assignments and reporting on/off per member and team call the API with version; team-scope managers see the 403 as 'All-scope managers only'; staff get only their own cut (read-only)", async () => {})
test("loading.tsx of /, /shifts, /daily-reports and the detail route import no data layer; skeletons for the dashboard, Today, deadline card, shifts grid, inbox and report detail match (re-measured at 1568, 768, 390)", async () => {})
```
Contract (**real API**): `test("shifts, occurrences, reporting, reports (current, list, detail, versions), template, report-exports, dashboard (manager, staff, team-tasks), attention and today responses parse against the strict schemas and map through the adapters with no undefined", async () => {})`, `test("submit through the client wrappers: open, draft, submit with a requestId twice gives one version", async () => {})`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(web): shifts, reports, dashboard and Today on the API`.

---

### Task T6.8: Platform console on the API, the rest isolated

**Files:** `features/platform/{api,adapters,client,mock}.ts`, `app/(platform)/**` gates, `features/platform/store.ts` (the backed parts removed), `lib/platform-notice-data.ts`.

Step 0 (first commit): write the page-by-route **coverage table** into `.claude/docs/features/platform.md` from the generated `paths`. Expected result: backed = tenants list and 360 aggregates (`/v1/platform/tenants*`), suspend, reactivate, extend trial, module overrides, metrics (`/v1/platform/metrics`), data requests, audit and export, staff (`/v1/platform/staff*`), settings (email, storage, billing), support grants. **Unbacked and mock-isolated (I16):** plans (list, new, edit, archive), invoice ledger and dunning, usage series, tenant notes, change-plan, schedule-deletion, the subscription event log behind the MRR chart where `/v1/platform/metrics` does not cover it. The operator is the signed-in user (`/v1/me.platformRole`), not `platform/staff.json`; the `od-staff-role` override is deleted.

- [ ] **Step 1: Failing tests**
```ts
test("a non-staff user gets 404 on /v1/platform/*; the pages show 'Access restricted' with no console nav or data in the payload", async () => {})
test("staffCan mirrors the API: viewer reads only; billing role cannot suspend; owner needs MFA (401 mfa_enrolment_required shows the gate); the last owner cannot be demoted", async () => {})
test("tenants list and 360 map the aggregate DTOs; no member names or emails appear (aggregates only); sort, filter and saved views keep working on the server paging", async () => {})
test("suspend and reactivate require a reason (1-500 chars); 409 already_suspended and not_suspended show their copy; extend-trial days 1-30; module overrides send the full overrides array", async () => {})
test("support grants: create (reason, hours 1-24) and revoke; the tenant's /settings/support-access shows the same grant", async () => {})
test("overview KPIs and MRR come from /v1/platform/metrics (MRR counts only active, past_due is separate, C11); the plan-mix and recent-activity cards that need unbacked data are mock and gated", async () => {})
test("data requests and audit pages map the DTOs; audit export streams through the BFF", async () => {})
test("settings: email and storage save without ever receiving the secret back (keyLast4 only); test buttons show ok/failed; billing mode label feeds the topbar pill", async () => {})
test("with ENABLE_MOCK_MODULES unset the unbacked pages show the unavailable state and their nav entries are hidden; with it set they show the mock data unchanged", async () => {})
test("loading.tsx of every platform route imports no data layer; skeletons match", async () => {})
```
Contract (**real API**): `test("platform tenants, detail, metrics, data-requests, audit, staff and settings responses for a platform owner parse against their schemas and map through the adapters", async () => {})`.

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(web): platform console on the API with the unbacked pages isolated`.

---

### Task T6.9: e2e for CR-01..CR-06, smoke on the real stack, mock isolation and cutover

**Files:** `playwright.config.ts`, `e2e/{global-setup,fixtures}.ts`, `e2e/cr0{1..6}.spec.ts`, `scripts/smoke.mjs` and `scripts/smoke*.json` (real login), `test/mock-isolation.test.ts`, `lib/mock-registry.ts` and the `MockGate` in each mock page, `.github/workflows/ci.yml` (`contract` and `e2e` jobs), `.claude/docs/{architecture.md (Data layer, mock isolation), features/*.md (Backend notes), deploy/b6-cutover.md}`, `.claude/docs/README.md`.

**CR-01..CR-06** are the SRS §5.1 first-client requirements; their acceptance criteria are in §4.3 and §5.4 and the traceability matrix is §15. Playwright runs one spec per CR on the seeded demo tenant (`storageState` per persona signed in through the API in `globalSetup`; one spec per CR also signs in through the UI once). Projects: `desktop` (Chromium 1440x900) and `android` (Pixel 7 emulation).

| Spec | Acceptance | Happy path |
|---|---|---|
| `cr01` | AC-M1-01, AC-M1-02 | An all-scope manager turns reporting on for 3 of 5 members in `/shifts`; only those 3 have a report today; a member opens the report, sees exactly their shift tasks, sets statuses and minutes, submits; the manager sees the tasks updated (status, time, neutral history line). |
| `cr02` | AC-M0-03, AC-M1-06 (desktop) | A member on an unregistered browser sees "Available on your work PC" and no Drive option; an admin issues an enrolment code in Settings → Devices; the member enters it under Account → Security; the chip reads the company PC and the Drive option appears; an admin resets the binding and it disappears again. |
| `cr03` | AC-M1-03 | A member submits; the manager sees the complete report in the inbox within one minute (poll the inbox, no reload cheat), accepts it with a comment; a seeded past-deadline member shows "Missing". |
| `cr04` | AC-M1-04 | A manager adds a task for a member, reassigns it, reschedules it with the knock-on preview, then removes it (archive); the member's bell shows each change and the task history lists them. |
| `cr05` | AC-M1-05 | On a proof-required task Complete is refused without proof; the member uploads a photo (real ClamAV and MinIO), it shows Scanning then clean, Complete moves the task to review; a different manager verifies and the capture time shows; the member (assignee) and a co-assignee manager get no Verify. |
| `cr06` | AC-M1-06, AC-M1-07 | In the Android context with a bound Android device: Drive is blocked ("Available on your work PC" copy, no link, adding a Drive evidence item is refused with the policy message) while creating a task, moving it, ticking a checklist and submitting a report all work on the phone viewport. |

- [ ] **Step 1: Failing tests**
```ts
// test/mock-isolation.test.ts (default run, no Docker)
test("getData( and lib/data are imported only by files listed in lib/mock-registry", async () => {})
test("switched features never import ME_ID, isAssigned seed filters, scopeReports, materialiseRecurring or mergeIncoming from routes or components", async () => {})
test("no loading.tsx imports a data layer (features/*/api, lib/api, lib/data)", async () => {})
test("with ENABLE_MOCK_MODULES unset every mock route renders the unavailable state and its nav entry is hidden; with it set they render", async () => {})
test("deleted files from I15 are gone and nothing imports them", async () => {})
// smoke (scripts/smoke.mjs, real stack)
// each entry gains { as: "<persona>", tenant: "<slug>" }; the runner signs in through /api/auth/sign-in/email with SMOKE_PASSWORD, keeps a cookie jar per persona, sets od-tenant, and asserts the same expect/notExpect text as before (counts hold because of the seed)
```
Playwright: the six specs above, each asserting the acceptance text and, for CR-05 and CR-06, the refusals. Each spec cleans up after itself or runs against a freshly seeded database (`globalSetup` runs `seed:demo --reset` once).

- [ ] **Step 2–5:** Run → FAIL. Implement; start the stack (`docker compose -f docker-compose.dev.yml up -d --wait postgres redis minio clamav mailpit`, `npm -w api run seed:demo`, API and web), then `npm run test:e2e`, `npm run smoke`, `npm run test:contract`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `node scripts/check-bundle.mjs`, `npm -w api test`. Commit `test(web): CR-01..CR-06 e2e, real-login smoke, mock isolation and cutover docs`.

---

## Requirement coverage

| Requirement | Task |
|---|---|
| CR-01 / AC-M1-01, AC-M1-02 (FR-M1-20..26) | T6.7, e2e `cr01` |
| CR-02 / AC-M0-03, AC-M1-06 (FR-M0-08..10, FR-M1-50..52) | T6.3 (cookie, `features.drive`), T6.5 (devices, bind), T6.6 (Drive), e2e `cr02` |
| CR-03 / AC-M1-03 (FR-M1-27..31, 61) | T6.7, e2e `cr03` |
| CR-04 / AC-M1-04 (FR-M1-10..14) | T6.6, T6.4 (bell), e2e `cr04` |
| CR-05 / AC-M1-05 (FR-M1-40..49) | T6.6, e2e `cr05` |
| CR-06 / AC-M1-06, 07 (FR-M1-52..55) | T6.3, T6.6, T6.7, e2e `cr06` (the app itself is out of scope) |
| AC-M0-02 forced MFA | T6.3 (`MfaGate`, step-up) |
| AC-M0-04 audit of permission and policy changes | T6.5 (audit page shows them) |
| AC-M0-05 module removed hides within one minute | T6.4 (entitlements not cached) |
| FR-M0-03 sign-in, MFA, SSO, email verification | T6.3 |
| FR-M0-13 audit log view and export | T6.5 |
| FR-M0-14, 15 billing, entitlements, 402/403 | T6.4 |
| FR-M0-19, 20 platform console, no hard-coded tenant values | T6.8, T6.4 |
| Review Focus 1 to 5 | T6.3, T6.1/T6.3, T6.6/T6.7, T6.1 to T6.8, T6.9 |

### Follow-up items (every B6 item in the ledgers)

| Item | Task |
|---|---|
| B5: export rows drift (`export-rows.ts` vs domain builder) | T6.7 (shim and parity test) |
| B5: report scope one level (F5) vs `teamOf` | I14, T6.2 (seed), T6.7 (test) |
| B5: template matched by team name | I26, T6.5 (API fix and test), T6.7 |
| B5: `seriesId` uuid vs ref | I11, T6.6 |
| B5: `ReportSchema` catchall → typed | T6.1 |
| B5: `canVerify` full assignee list | T6.6 |
| B5: export status `expired` | T6.7 |
| B5: Today `dayKey` (422 `invalid_day_key`) | T6.7 |
| B5: report row notes not in task history (H4) | T6.6, T6.7 |
| B5: attention decide/outstanding, coverage, expiring docs stay mock (G1) | I16, I18, T6.7, T6.9 |
| B5: compare instants, not wall strings (DST) | I12, T6.6, T6.7 |
| B4: `parentRef` omitted for out-of-scope parent; E15 board/calendar `parentId` | T6.6 |
| B4: `POST /v1/tasks` takes no `repeat` (two calls) | I13, T6.6 |
| B4: ISO `dueAt`/`startAt` for unchanged dates (DST fold) | I12, T6.6 |
| B4: `409 retry` from any write | I10, T6.1 (client), T6.6, T6.7 |
| B3: `/settings/support-access` page missing | T6.5 |
| B3: audit action catalogue for the FE missing | T6.5 |
| B3: starter tenants cannot upload (branding logo) | T6.5 (logo only with files module) |
| B3: `plans.json` vs plans table drift | I20, T6.5 (parity test) |
| B3: 402/403 contract; first client's plan set in the console (C8) | T6.4; go-live checklist in `deploy/b6-cutover.md` |
| B2: browser upload needs bucket CORS (presigned PUT) | I30, T6.9 deploy doc |
| B2: pre-go-live items (Art. 15 export completeness, R2 lifecycle on `u/`, clamd limits, pg_trgm, migration 0020 and bootstrap roles in the runbook) | not web work; listed in `deploy/b6-cutover.md` |
| B0-B1: unify the MFA error contract before web wiring | I22, T6.3 |
| B0-B1: `/list-sessions` returns raw tokens | I21, T6.3 |
| B0-B1: Origin check for tenant-less `/v1` mutations | I6, T6.1 |
| B0-B1: `/verify-email` verifies only after a click | I23, T6.3 |
| B0-B1: invites re-validate on accept, add list and revoke | I25, T6.5 |
| B0-B1: device retire route missing | I24, T6.5 |
| B0-B1: shared rate-limit store and proxy IP header | deploy doc: the proxy must overwrite `x-forwarded-for`; the BFF forwards the proxy's value (T6.1 test) |

## Done criteria for B6

- Every row of the two coverage tables has a passing test. The five Review Focus tests pass. AC-M0-02, AC-M0-03, AC-M1-01..06 pass as Playwright specs on the seeded demo tenant.
- `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm -w api test`, `npm run api:types:check`, `npm run test:contract`, `node scripts/check-bundle.mjs`, `npm run smoke` and `npm run test:e2e` are green; `npm audit --audit-level=high` is clean for the two new dev dependencies.
- No `getData` outside the mock registry; the files in I15 are gone; no `loading.tsx` touches the network; mock pages are unavailable when `ENABLE_MOCK_MODULES` is unset.
- The seed is idempotent, refuses production and foreign databases, prints no secret, and the demo (`ENABLE_MOCK_MODULES=1` plus the seed) shows the same counts the mock showed (smoke).
- Security: no token or secret in a bundle; session cookies never readable by JS; `x-tenant` only from the server; cross-origin POST refused at the BFF and the API; raw session tokens unreachable; problem bodies shown as mapped copy with a Ref only.
- Skeletons re-measured for every changed page (1568, 768, 390) and recorded in `architecture.md`; hover, disabled, read-only and open states checked in light and dark.
- `.claude/docs/features/*.md` Backend notes, `architecture.md` Data layer and `deploy/b6-cutover.md` (env `API_URL`, `APP_ORIGIN`, `APP_URL` = web origin, bucket CORS, `x-forwarded-for` overwrite, Stripe webhook route to the API host, first client's plan in the console, seed on the demo deployment only) are written.

## Decisions needed before the work starts

1. **TOTP QR code.** The mock showed a placeholder QR. T6.3 renders the secret (copy button) and the `otpauth://` link, which every authenticator app accepts, and adds no dependency. A real QR needs a small library (for example `qrcode`, pinned). Decide: ship without QR in B6 (default in this plan) or add the library.
2. **Demo deployment.** The live demo needs `ENABLE_MOCK_MODULES=1`, a seeded database and `SEED_DEMO_PASSWORD` set by the owner in Dokploy (never committed). Confirm the demo environment and its database are separate from the first client's production database; the seed refuses a database that holds any other tenant, but it cannot tell a demo host from a production host by name.
3. **First client's module list.** I16 hides every FE-only module (rosters, orders, recruitment, payroll issues, files, assistant) from a deployment without `ENABLE_MOCK_MODULES`. The product owner's standing rule is never to remove Orders & Stock and client files: they are kept, only hidden until their backends exist. Confirm the first client's go-live is acceptable without them visible.
4. **Platform operator accounts.** The platform owner needs 2FA before any console call (B3). The seed creates one only when `SEED_PLATFORM_TOTP_SECRET` is provided; the real first operator is still created with `npm -w api run platform:owner` (B3).

## Notes for B7 and later

- B7 (hardening) inherits the k6 run through the BFF, the shared rate-limit store, and the multi-instance read-model cache (G2).
- B8 replaces the mock rosters and the I17 overlay; B11 replaces the manager-attention workflow, adds search facets (I19), team-id template keys, and the tenant-default notification settings; each removes its entry from `lib/mock-registry.ts`.
- The PDF export is Latin-1 only (B5); a Unicode font is a follow-up. A QR code for TOTP set-up needs a small library (see "Decisions needed").
