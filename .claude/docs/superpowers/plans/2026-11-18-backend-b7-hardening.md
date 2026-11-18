# Backend B7: Phase 1 hardening and deploy readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read `node_modules/next/dist/docs/` before any web (Next) change** (AGENTS.md).

**Goal:** Close every B6 carry-over, make the tenant-isolation gate complete, add the observability, load and security evidence the SRS asks for (NFR-06/07/08/13/14/15), and leave the repo with everything a Dokploy go-live needs as files and docs, without performing a live deploy.

**Architecture:** Twenty small tasks in risk order. Tasks 1 to 12 are product and API fixes (each with its own failing test first), 13 to 16 are test-infrastructure and observability, 17 to 20 are evidence, security review, deploy files and dependency triage. No new product features. New runtime dependencies only where a task names them (none expected; k6 is an external binary, not an npm package).

**Tech Stack:** Hono + `@hono/zod-openapi`, Drizzle + Postgres (RLS), Better Auth, BullMQ/Redis, pino, Vitest + Testcontainers (api), Next.js 16 (web, BFF), Playwright, k6 (script only), Docker/Dokploy.

**Spec:** `.claude/docs/requirements/SRS.md` (NFR-03/06/07/08/09/13/14/15/16, AC-M0-01, Appendix A Phase 1 plan), `.claude/docs/superpowers/plans/2026-11-16-hono-backend-roadmap.md` (B7 = T7.1 to T7.4, gate: "client signs off CR-01..CR-06, security review passed"), `.claude/docs/superpowers/plans/2026-11-18-backend-b6-followups.md` ("First items of the B7 plan" and "Carry to B7 / B8" are mandatory scope), `.claude/docs/deploy/b6-cutover.md`, `.claude/docs/deploy/demo-seed.md`.

## Rulings (made for B7; binding for later phases)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| S1 | Order is by risk: privacy leak (1), stale UI state (2), edge trust and abuse (3, 4), account-creation abuse (5), then API gaps (6 to 12), then test infrastructure (13, 14), observability (15, 16), evidence (17, 18), deploy (19), triage (20). Each task is independently mergeable and leaves every suite green. | R1 is the only known data leak. | none |
| S2 | R1 fix: the history row stores the knock-on cause **structurally** (`task_history.cause_task_id uuid null`, same-tenant FK, `ON DELETE SET NULL`); the stored `text` becomes the neutral "Moved because another task was rescheduled"; the DTO builder renders "Moved because TSK-n was rescheduled" at **read time** only when the caller can see the cause task (same visibility rule the dependency refs use), else a neutral "Moved because a task you cannot see was rescheduled" and `hiddenDependencies` is not touched. A migration rewrites old rows (regex on the legacy text, resolved to the task id inside the tenant) so history written before B7 is safe too. | Redaction at read time cannot be bypassed by a later reader of the column; a text rewrite alone would leave the ref in old rows. | Old rows whose root task was deleted keep the neutral text (acceptable). |
| S3 | `x-forwarded-for` trust becomes explicit config: `TRUST_PROXY_HOPS` (int, default `1` in production, `0` in development/test). The client IP is the entry `hops` from the right of the header (so entries a client prepends are ignored); with `0` the header is ignored and the socket address is used. One helper (`api/src/core/net/client-ip.ts`) is the only reader; Better Auth `advanced.ipAddress.ipAddressHeaders` and every API rate limit use it. | The B6 cutover relies on "the proxy must overwrite"; this makes a wrong proxy fail safe instead of silently. | An operator who sets a wrong hop count rate-limits the proxy's IP; the deploy doc has a check. |
| S4 | Rate limits use a **shared Redis store** (not per-instance memory) and apply in every environment except `test` (where a `RATE_LIMIT_DISABLED=1`-style switch is not added; tests inject the fake store). Buckets: auth endpoints per IP, TOTP verify per user (5 failures per 15 min then 429 `mfa_attempts_exceeded`, counter reset on success; also a used-code replay guard for the current 30 s step), `POST /v1/tenants` per user, invite and password-reset mail per target address. | B0/B1 follow-ups deferred "no per-session TOTP attempt cap / replay" and "mail bomb bounded only by limiter". | Redis outage: limiter fails **open for reads, closed for TOTP verify and auth sign-in** (documented). |
| S5 | `POST /v1/tenants`: at most `TENANT_CREATE_MAX_PER_USER` (env, default 5) tenants **created** by one user (counted from `tenants.created_by`), over cap is 403 `tenant_limit_reached`. The user's **first** tenant is exempt from MFA (sign-up onboarding has nothing to enrol into yet); the second and later require an MFA-verified session (same rule as `requireMfaOk`, 401 `mfa_challenge` / `mfa_enrolment_required`). | SRS silent; cheap abuse and an account-takeover amplifier. | A legitimate agency with 6 tenants asks support; the cap is env, not code. |
| S6 | Template concurrency uses the HTTP standard, for the **report template** only: `GET /v1/shift-reports/template` returns `ETag: "<version>"`, `PUT` requires `If-Match`; missing is 428 `precondition_required`, stale is 412 `precondition_failed` with the current ETag. (Task templates already use a body `version`; they stay.) The UI maps 412 to the existing "Changed by someone else" reload banner, never to a silent overwrite. | The follow-up asked for etag/If-Match; the B6 text conflicts (O1) used 409 for task writes, so a different status for a different mechanism keeps the BFF mapping unambiguous. | The BFF must forward `If-Match` and `ETag` (allow-listed in Task 8). |
| S7 | Audit API additions are additive: `GET /v1/audit` gains `actorId`, `action` (exact), `actionPrefix`, `from`, `to`, `cursor`, `limit` (max 100, default 50); keyset cursor on `(created_at, id)` (same opaque cursor codec as tasks). The export route takes the same filters. Chain verification is untouched. | NFR-05; the console and settings need paging. | none |
| S8 | `GET /v1/tasks` gains `teamId` (uuid, matched to assignee team membership in the caller's scope; out-of-scope team = empty list, not 404, so existence is not an oracle). The reverse edge ("Blocks") is capped at 50 per task detail with `hiddenBlocks` counting both the cap overflow and the out-of-scope ones. | N3 and the unbounded edge. | The FE shows "+n more" using the existing count. |
| S9 | DST reschedule rule (the SRS and B5 are silent): a wall time that does not exist (spring forward) moves to the first valid minute after the gap; a wall time that happens twice (fall back) takes the **first** occurrence. Knock-on keeps each task's wall-clock time-of-day when the day shifts across a DST change. Pinned with tests for 29 Mar 2026 and 25 Oct 2026 in Europe/Dublin. | `instantOfWall` behaviour must be a decision, not an accident. | A user in the repeated hour sees the first occurrence. |
| S10 | Metrics: Prometheus text at `GET /metrics` on a **separate internal port** (`METRICS_PORT`, off when unset, never behind the public proxy) via a tiny in-house registry (counters and histograms, no `prom-client`). Traces and per-tenant error tracking use **hooks that need no provider**: an `ErrorReporter` interface (`capture(err, ctx)`) with a pino-backed default and a no-op; a Sentry or OTel adapter is a later 20-line file, not a B7 dependency. | NFR-14 needs the hooks and labels; the provider is a deploy-time choice. | Adapter work moves to the first week of go-live. |
| S11 | Multi-instance read-model cache: replace "bust only this instance" with a per-tenant **version stamp in Redis** (`rm:v:<tenantId>` integer, INCR on any bust, read with the 30 s TTL cache key suffix). Worker writes also INCR. Single-instance behaviour and the 30 s TTL stay. | Documented G2 limitation; two instances are likely in production. | One extra Redis GET per read-model read (budgeted in the load test). |
| S12 | Sweeps stay single-job, iterate all tenants; B7 adds the per-tenant batch size and duration metric and a documented trigger (shard when a sweep exceeds 60 s or 250 tenants). No sharding code. | YAGNI at one client. | Revisit at tenant 50. |
| S13 | Dead webhook deliveries get a manual replay (`POST /v1/webhooks/{id}/deliveries/{deliveryId}/replay`) **only if** the Task 14 route inventory shows it missing; otherwise deferred. Default: deferred to B8 and listed in Deferred. Audit head anchoring (HMAC or external anchor) stays deferred: the real control is privileges (B0/B1 ruling), stated in the security checklist. | Scope control. | none |
| S14 | Deploy deliverables are **files and docs only**: `docker-compose.prod.yml` (reference), Dockerfile stages, `.env` matrix, backup/restore and migration and rollback runbooks, a restore-drill script that runs against Testcontainers/compose, never against a host. No Dokploy API calls, no secrets. | Task brief. | none |
| S15 | npm audit: `npm audit --audit-level=high` stays in CI as is. Triage writes `.claude/docs/deploy/audit-triage.md` (advisory, package path, prod or dev, reachable yes/no, action) and adds `overrides` only where the fix is a non-breaking patch; major downgrades of dev tooling are **not** taken. CI gains `npm audit --omit=dev --audit-level=high` as the blocking job; the full audit becomes informational (reported, not failing). | 35 findings, 15 high, all dev tooling per B6. | If a dev-tool advisory becomes reachable in CI, it is re-triaged. |

## Global Constraints

- All B0 to B6 constraints hold: problem+json everywhere; cross-tenant id answers 404 (never 403); module not in plan 403 `module_not_entitled`; unpaid 402 `billing_required` on non-GET (notification read/read-all exempt, K5); `409 retry` repeats once; `deps.clock` is the only clock on the API side; RLS template (R8) on every new table; every JSON body has `.openapi({ example })`; audit for every security-relevant write.
- Mutation order inside a transaction: namespaced advisory locks, then `lockActor`, then row `FOR UPDATE`, then writes, then history, then `notify`, then `recordAudit`, then `publish` last.
- No secrets in logs, errors, bundles or the repo; no `NEXT_PUBLIC_*` for anything server-side; `scripts/check-bundle.mjs` stays green.
- Never hard-code tenant values (company, timezone, deadline, branding); thresholds that are tenant-specific live in settings, deploy-wide ones in env.
- Every new page or component keeps an exact-match skeleton and `loading.tsx` (K1: static, no API); UI follows `.claude/docs/00-design-system/ui-rules.md` (borderless, tokens, short copy, icons and numbers).
- After every task: `npm -w api test`, `npm -w api run typecheck`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 errors, 27 warnings baseline), `npm run api:types:check` (run `npm run api:types` when the OpenAPI document changed), `npm run build` and `npm run check:bundle` for any web change.
- Baselines to hold or raise: root vitest 1668, contract 40, api 1163.
- Features do not import each other; `features/<f>/index.ts` is the only entry; `.claude/docs/features/*.md` Backend notes are updated for every API change.
- Migrations are numbered from `0040`, run as `app_owner`, and are additive (no destructive change without a two-step plan in the task).

## Review Focus

1. A caller with a narrower scope reads task history, notifications and search results after a knock-on reschedule: no task ref, title or id outside their scope appears anywhere (history text, `changes`, notification body, event payload, search hit). Test owner: Task 1.
2. A client sends a forged `x-forwarded-for` (single, multiple, spaced, IPv6, empty) and tries to pick its own rate-limit bucket or evade the TOTP attempt cap. It must not. Test owner: Task 3.
3. A browser opens a user-uploaded file (HTML, SVG, PDF with script) from a download link: it must download or render inert, never execute in the app or API origin. Test owner: Task 4.
4. Two people save the report template, or one person with two tabs reloads after a 412: the later save never silently wins and the UI shows the server copy. Test owner: Task 8.
5. A tenant with 5 000 audit rows, a task blocking 500 others, or a day with a DST gap is requested: bounded response size, stable cursor order with equal timestamps, no 500. Test owners: Tasks 9, 10, 11.

---

## File structure (new or changed, by responsibility)

- `api/src/core/net/client-ip.ts` (new): the one reader of the client address.
- `api/src/core/middleware/rate-limit.ts` (new): Redis-backed limiter plus fake; `api/src/core/middleware/secure-headers.ts` (new).
- `api/src/core/observability/` (new): `logger.ts` (request-scoped child logger), `metrics.ts`, `error-reporter.ts`, `access-log.ts`.
- `api/src/modules/tasks/history.ts`, `planning.ts` (R1); `api/src/modules/audit/query.ts`, `routes.ts`; `api/src/modules/tenants/service.ts`; `api/src/modules/platform-console/support-grants-routes.ts`, `routes.ts`; `api/src/modules/shift-reports/` (template ETag).
- `api/test/` (isolation completeness: `route-inventory.test.ts` new; `isolation.test.ts`, `platform-isolation.test.ts` new).
- `load/` (new, repo root): `k6/*.js`, `README.md`, `thresholds.json`.
- `deploy/` (new, repo root): `docker-compose.prod.yml`, `.env.matrix.example`, `scripts/restore-drill.sh`; docs in `.claude/docs/deploy/`.
- Web: `features/search/components/global-search.tsx`, `lib/session-route.ts`, `lib/session.ts`, `app/api/session/`, store-clearing in `lib/` session hooks.

---

### Task 1: R1 history knock-on ref redaction

**Files:**
- Create: `api/src/db/migrations/0040_history_cause.sql` (+ drizzle meta entry via the project's migration generator)
- Modify: `api/src/db/schema/tasks.ts` (`taskHistory.causeTaskId`), `api/src/modules/tasks/planning.ts:239`, `api/src/modules/tasks/history.ts` (`writeHistory` input, `historyDtos` render)
- Test: `api/src/modules/tasks/tasks.test.ts` (or a new `history-redaction.test.ts` beside it), `api/test/rls-guard.test.ts` stays green

**Interfaces:**
- Consumes: `writeHistory(tx, ctx, taskId, input)` and `historyDtos(tx, ctx, rows)` (history.ts), the dependency visibility predicate already used for `hiddenDependencies`.
- Produces: `writeHistory` input gains `causeTaskId?: string`; `HistoryRow.causeTaskId: string | null`; `HistoryDto` unchanged in shape (the text is already the rendered string).

- [ ] **Step 1: Write the failing tests**
  - `knock-on history text shows the cause ref to a caller who can see the root task`
  - `knock-on history text hides the root ref from an employee who cannot see the root task (neutral text, no TSK- anywhere in the JSON body)`
  - `knock-on history does not change hiddenDependencies for the redacted cause`
  - `legacy row text "Moved because TSK-7 was rescheduled" is neutral for an out-of-scope caller after migration 0040 (backfill resolves cause_task_id)`
  - `notification body, event payload and search hit for the moved task contain no root ref (grep the JSON for /TSK-\d+/ of the root)`
  Assertions: `expect(JSON.stringify(body)).not.toContain(rootRef)` for the out-of-scope caller.
- [ ] **Step 2: Run** `npm -w api test -- history-redaction` and confirm FAIL.
- [ ] **Step 3: Implement** the migration (add column, FK `(tenant_id, cause_task_id)`, `SET NULL`, backfill update joining `tasks.ref_no` parsed from the legacy text, rewrite legacy text to the neutral form), then the schema, `planning.ts` (store `causeTaskId: root.id`, neutral text), and `historyDtos` (batch-load visible task refs for `causeTaskId` in one query, reuse the dependency visibility check, render the two texts of ruling S2).
- [ ] **Step 4: Audit step**: `grep -rn "ref(" api/src/modules/tasks/*.ts api/src/modules/notifications` and list every place a ref of a different task is embedded in persisted text; each one is either structural already or fixed here with a test line. Record the list in the commit message.
- [ ] **Step 5: Run** the history tests, `npm -w api test`, and `api/test/rls-guard.test.ts`; expect PASS.
- [ ] **Step 6: Commit** `fix(api): knock-on history stores the cause structurally and redacts at read time`

### Task 2: Search stale in-flight load generation counter

**Files:**
- Modify: `features/search/components/global-search.tsx`
- Test: `features/search/global-search.test.tsx` (new; the folder already holds `search-api.test.ts`)

**Interfaces:**
- Consumes: `searchApi` from `features/search/api.ts` (unchanged).
- Produces: internal `loadGen` ref only; no exported change.

- [ ] **Step 1: Write the failing tests**
  - `a load that resolves after reset does not repopulate results`
  - `a load that resolves after company switch does not repopulate results or recents`
  - `two overlapping loads: only the latest generation commits`
  Use a deferred promise for the first request, call the reset path, resolve the deferred, assert the list stays empty.
- [ ] **Step 2: Run** `npx vitest run features/search` and confirm FAIL.
- [ ] **Step 3: Implement** a monotonically increasing generation captured by each load and compared before every state commit; reset and tenant switch increment it (alongside the existing abort).
- [ ] **Step 4: Run** the same command, `npx tsc --noEmit`, `npx eslint features/search`; expect PASS.
- [ ] **Step 5: Commit** `fix(web): search ignores stale in-flight loads after reset`

### Task 3: Edge trust, shared rate limits, TOTP attempt cap

**Files:**
- Create: `api/src/core/net/client-ip.ts`, `api/src/core/middleware/rate-limit.ts`
- Modify: `api/src/env.ts` (`TRUST_PROXY_HOPS`, `TENANT_CREATE_MAX_PER_USER` later), `api/src/modules/auth/*` (Better Auth `advanced.ipAddress`, secondary storage on Redis), `api/src/modules/mfa/service.ts` (attempt counter and replay guard), `api/src/deps.ts` (`rateLimiter`), `api/test/fakes.ts`
- Test: `api/src/core/net/client-ip.test.ts`, `api/src/core/middleware/rate-limit.test.ts`, `api/src/modules/mfa/mfa.test.ts`

**Interfaces:**
- Produces: `clientIp(headers: Headers, socketAddr: string | undefined, hops: number): string`; `interface RateLimiter { hit(key: string, rule: { limit: number; windowSec: number }): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> }`; `rateLimit(name: string, rule, keyOf: (c: Context<AppEnv>) => string, opts?: { failClosed?: boolean }): MiddlewareHandler<AppEnv>`; `Deps.rateLimiter: RateLimiter`.

- [ ] **Step 1: Write the failing tests**
  - `clientIp ignores x-forwarded-for when hops is 0`
  - `clientIp takes the entry hops from the right (client-prepended entries are ignored)` with `"1.1.1.1, 2.2.2.2"` and hops 1 giving `2.2.2.2`
  - `clientIp handles spaces, IPv6 and an empty header`
  - `rate limiter 429 carries retry-after and problem+json code rate_limited`
  - `forged x-forwarded-for does not give a caller a fresh bucket`
  - `totp verify locks after 5 failures with 429 mfa_attempts_exceeded and resets on success`
  - `a totp code used once cannot be replayed inside its step`
  - `limiter store down: auth and totp fail closed, reads fail open`
- [ ] **Step 2: Run** `npm -w api test -- client-ip rate-limit mfa` and confirm FAIL.
- [ ] **Step 3: Implement** the helper and the Redis limiter (fixed window with `INCR` + `EXPIRE` in one script), wire `Deps.rateLimiter` (fake in tests), apply the buckets of ruling S4, point Better Auth's IP header config at the helper.
- [ ] **Step 4: Run** the three files and the whole api suite; expect PASS.
- [ ] **Step 5: Commit** `feat(api): explicit proxy trust, shared rate limits and TOTP attempt cap`

### Task 4: Download hardening and API security headers

**Files:**
- Create: `api/src/core/middleware/secure-headers.ts`
- Modify: `api/src/core/storage/s3-storage.ts` (`presignGet`), `api/src/modules/files/routes.ts` (download), `api/src/modules/task-evidence` download path, `api/src/modules/shift-reports/routes.ts` (file and export downloads), `api/src/app.ts`
- Test: `api/src/modules/files/files.test.ts`, `api/src/core/storage/s3-storage.test.ts` (new if absent), `api/src/app.test.ts`

**Interfaces:**
- Produces: `presignGet(key, { name, mime, inline?: boolean })` where `inline` is honoured only for the allowlist `image/png|jpeg|webp|gif`, `application/pdf` (never `image/svg+xml`, `text/html`); `secureHeaders(): MiddlewareHandler<AppEnv>` sets `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on authenticated JSON, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API-served bodies.

- [ ] **Step 1: Write the failing tests**
  - `presigned GET URL for text/html is attachment with the stored mime, never the caller's`
  - `presigned GET for svg is attachment`
  - `inline is honoured for image/png and refused for image/svg+xml`
  - `API-streamed downloads (evidence nonce path, report export) carry nosniff and content-disposition`
  - `every API response carries x-content-type-options nosniff and a request id`
- [ ] **Step 2: Run** `npm -w api test -- files s3-storage app` and confirm FAIL.
- [ ] **Step 3: Implement** per ruling text: object responses from the bucket cannot carry `nosniff` through a presigned URL (S3 and R2 limit), so the doc gets a mandatory Cloudflare Transform Rule on the bucket domain (Task 19) and the API never links a bucket URL for a non-allowlisted mime without `attachment`.
- [ ] **Step 4: Run** the api suite; expect PASS.
- [ ] **Step 5: Commit** `feat(api): safe download dispositions and security headers on API responses`

### Task 5: POST /v1/tenants per-user cap and MFA

**Files:**
- Modify: `api/src/modules/tenants/routes.ts:41`, `api/src/modules/tenants/service.ts`, `api/src/env.ts`
- Test: `api/src/modules/tenants/tenants.test.ts`

**Interfaces:**
- Consumes: `rateLimit` (Task 3), the MFA session check used by `requireMfaOk`.
- Produces: `createTenant` throws `AppError(403, "tenant_limit_reached")`; second-and-later creation requires MFA per ruling S5.

- [ ] **Step 1: Write the failing tests**
  - `a user's first tenant is created without MFA`
  - `the second tenant needs an MFA-verified session (401 mfa_challenge without)`
  - `the (cap+1)th tenant is 403 tenant_limit_reached; TENANT_CREATE_MAX_PER_USER=2 lowers it`
  - `tenants created by another user do not count towards the cap`
  - `creation is rate limited per user and the response never reveals other tenants`
- [ ] **Step 2: Run** `npm -w api test -- tenants` and confirm FAIL.
- [ ] **Step 3: Implement** the count by `tenants.created_by` (confirm the column exists; if not add it in migration `0041_tenant_created_by.sql`, backfilled from the owner membership of the oldest owner, nullable) and the MFA gate.
- [ ] **Step 4: Run** the tenants tests and `api/test/isolation.test.ts`; expect PASS. Update the web onboarding copy to the generic "limit reached" short message if the sign-up flow can hit it (check `features/` onboarding; add a unit test line if changed).
- [ ] **Step 5: Commit** `feat(api): cap tenant creation per user and require MFA for the second tenant`

### Task 6: Cheap platform MFA probe endpoint

**Files:**
- Modify: `api/src/modules/platform-staff/routes.ts`, the web console probe in `lib/` or `features/platform-console` (find with `grep -rn "platform/tenants" lib features | head`, the call that loads all tenants as a probe)
- Test: `api/src/modules/platform-staff/platform.test.ts`, the web probe's unit test

**Interfaces:**
- Produces: `GET /v1/platform/session` returning `{ staff: true, role: "owner" | "support" | "billing" | "viewer", mfa: "ok" }`; 401 `mfa_challenge` / `mfa_enrolment_required` exactly as the other platform routes; 404 to non-staff (no existence oracle, same as C4); at most one indexed staff lookup, no tenant query.

- [ ] **Step 1: Write the failing tests**
  - `staff with a verified second factor gets 200 with role`
  - `staff without a verified second factor gets 401 mfa_challenge`
  - `non-staff gets 404 not_found`
  - `the probe runs no tenant-table query` (assert via a query counter in `api/test/timing.ts` or a spy on `deps.db`)
  - web: `console probe calls /v1/platform/session and no longer the tenants list`
- [ ] **Step 2: Run** the api and web tests; confirm FAIL.
- [ ] **Step 3: Implement** the route and switch the web probe; regenerate API types (`npm run api:types`).
- [ ] **Step 4: Run** both suites, `npm run api:types:check`; expect PASS.
- [ ] **Step 5: Commit** `feat(api,web): cheap platform session probe for the console`

### Task 7: Staff support-grant list route

**Files:**
- Modify: `api/src/modules/platform-console/support-grants-routes.ts`, `support-grants.ts`
- Test: `api/src/modules/platform-console/support-grants.test.ts`

**Interfaces:**
- Produces: `GET /v1/platform/support-grants?tenantId=<uuid>&status=active|expired|revoked&limit&cursor` for staff roles `owner|support|billing|viewer`; items `{ id, tenantId, tenantName, grantedBy, scope, createdAt, expiresAt, revokedAt|null }`; keyset cursor like Task 9; platform audit entry `support_grant.listed` is **not** written (read), but a staff list read of another tenant's grants is logged at info.

- [ ] **Step 1: Write the failing tests**
  - `staff lists active grants across tenants, newest first`
  - `tenantId and status filters narrow the list`
  - `a tenant owner calling the platform route gets 404`
  - `cursor pages are stable with equal createdAt`
  - `the response has no grant secret or token`
- [ ] **Step 2: Run** `npm -w api test -- support-grants` and confirm FAIL.
- [ ] **Step 3: Implement** the route (response schema with `.openapi` examples), regenerate types.
- [ ] **Step 4: Run** the suite; expect PASS. Wire the walker spec in Task 14 (the route has no path param).
- [ ] **Step 5: Commit** `feat(api): staff support-grant list`

### Task 8: Report template If-Match / ETag and the UI conflict message

**Files:**
- Modify: `api/src/modules/shift-reports/routes.ts:61-65` and its service, `app/v1/[...path]/route.ts` (allow-list `if-match` upstream and `etag` downstream), `features/settings/components/template-panel.tsx` (or the shift-report template panel found by `grep -rn "shift-reports/template" features lib`), the matching skeleton file only if the component layout changes
- Test: `api/src/modules/shift-reports/shift-reports.test.ts`, `test/contract/` (a contract test), `features/*/template-panel.test.tsx`

**Interfaces:**
- Produces: `GET` sets `ETag: "<version>"` per ruling S6; `PUT` requires `If-Match`; 428 `precondition_required`, 412 `precondition_failed`; the response of a successful PUT carries the new ETag. Web: error classifier maps 412 to `version_conflict`-style UI state: banner "Changed by someone else" with Reload (no Keep-mine for this panel; the form shows the server copy), single-flight guard so a double click on Reload fires one fetch.

- [ ] **Step 1: Write the failing tests**
  - api: `PUT without If-Match is 428`, `PUT with a stale ETag is 412 and returns the current ETag`, `PUT with the current ETag is 200 and bumps the ETag`, `two concurrent PUTs with the same ETag: exactly one wins`
  - contract: `BFF forwards If-Match and returns ETag`
  - web: `412 shows the reload banner and keeps the form on the server copy after Reload`, `Reload is single-flight`
- [ ] **Step 2: Run** the three suites; confirm FAIL.
- [ ] **Step 3: Implement** with the template row's existing version column; concurrent PUT safety uses the row lock then compare (mutation order in Global Constraints). Regenerate API types.
- [ ] **Step 4: Run** `npm -w api test`, `npm run test:contract`, `npx vitest run`, `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `feat(api,web): report template If-Match with a 412 reload message`

### Task 9: Audit API filters and cursor

**Files:**
- Modify: `api/src/modules/audit/routes.ts:21-30`, `api/src/modules/audit/query.ts`, `api/src/db/migrations/0041_audit_filter_indexes.sql` only if `EXPLAIN` in the test shows a seq scan on 5 000 rows (index `(tenant_id, created_at desc, id desc)` plus `(tenant_id, actor_id, created_at desc)`; number follows 0040/0041 order)
- Test: `api/src/modules/audit/routes.test.ts`, `api/src/modules/audit/audit.test.ts`

**Interfaces:**
- Produces: query `actorId?: uuid`, `action?: string`, `actionPrefix?: string`, `from?: iso`, `to?: iso`, `cursor?: string`, `limit` (max 100, default 50) per ruling S7; response `{ items, nextCursor: string | null }`; `GET /v1/audit/export` accepts the same filters.

- [ ] **Step 1: Write the failing tests**
  - `actor filter returns only that actor's entries`
  - `action exact and actionPrefix filters, and combining them is 400`
  - `from and to bound by created_at, to before from is 400`
  - `cursor paging walks 120 entries with equal timestamps without gaps or duplicates`
  - `a cursor from another tenant is rejected 400 and never leaks rows`
  - `limit above 100 is 400`
  - `verify chain still passes after the new reads` (reads never write)
- [ ] **Step 2: Run** `npm -w api test -- audit` and confirm FAIL.
- [ ] **Step 3: Implement** keyset pagination reusing the tasks cursor codec (move it to `api/src/core/cursor.ts` only if two modules now import it; otherwise import it; no duplicate codec).
- [ ] **Step 4: Run** the audit suite, `api/test/isolation.test.ts`, `npm run api:types:check`; expect PASS. The settings audit view and the console audit page get a one-line follow-up only if they call the route with new params (not in B7 scope otherwise).
- [ ] **Step 5: Commit** `feat(api): audit filters and keyset cursor`

### Task 10: Server teamId filter on GET /v1/tasks and the "Blocks" cap

**Files:**
- Modify: `api/src/modules/tasks/dto.ts` (`ListQuery` at :245, the blocks block at :160), `api/src/modules/tasks/repo.ts`, `features/tasks/api.ts` and the list "Load more under a narrowing filter" path (N3)
- Test: `api/src/modules/tasks/tasks.test.ts`, `features/tasks/*.test.ts`

**Interfaces:**
- Produces: `ListQuery.teamId?: uuid`; `BLOCKS_CAP = 50` exported constant; `hiddenBlocks` = out-of-scope + overflow.

- [ ] **Step 1: Write the failing tests**
  - `teamId filters to tasks assigned to members of that team within the caller's scope`
  - `teamId of a team the caller cannot see returns an empty list, not 404 (indistinguishable from an unknown team)`
  - `teamId combines with status, cursor and limit and pages without gaps`
  - `a task blocking 120 others returns 50 blocks and hiddenBlocks 70`
  - `blocks overflow ordering is deterministic (by due then id)`
  - web: `the team filter sends teamId and Load more keeps the filter`
- [ ] **Step 2: Run** both suites; confirm FAIL.
- [ ] **Step 3: Implement** the filter in the repo query with the existing scope predicate; cap the reverse edge in the SQL with `LIMIT`, counting the rest in one aggregate. Switch the web filter to the server param; remove the client-side narrowing workaround of ruling N3. Regenerate types.
- [ ] **Step 4: Run** `npm -w api test`, `npx vitest run`, `npm run test:contract`; expect PASS.
- [ ] **Step 5: Commit** `feat(api,web): server teamId task filter and capped Blocks edge`

### Task 11: DST reschedule tweak

**Files:**
- Modify: `api/src/modules/tasks/time.ts` (`instantOfWall`), `api/src/modules/tasks/planning.ts` (knock-on moves)
- Test: `api/src/modules/tasks/time.test.ts` (new), `api/src/modules/tasks/recurrence.test.ts` (existing, must stay green)

**Interfaces:**
- Produces: `instantOfWall(wall: string, tz: string): Date` follows ruling S9 (gap goes forward to the first valid minute, fold takes the first occurrence); deterministic for every IANA zone.

- [ ] **Step 1: Write the failing tests** (Europe/Dublin)
  - `01:30 on 29 Mar 2026 (does not exist) resolves to 02:00 local`
  - `01:30 on 25 Oct 2026 resolves to the first occurrence (UTC 00:30)`
  - `knock-on moving a task across the 29 Mar boundary keeps 09:00 wall time`
  - `due before start after the gap adjustment is rejected with the existing 422 code, not 500`
  - `America/New_York and Australia/Lord_Howe (30 minute shift) behave the same`
- [ ] **Step 2: Run** `npm -w api test -- time recurrence` and confirm FAIL.
- [ ] **Step 3: Implement** by probing the offset at the candidate instant and the two neighbours (algorithm is not determined by the signature: compute candidate = wall as UTC minus offset(candidate); recompute with the new offset; if the round trip does not reproduce the wall, it is a gap, add the gap length). Keep the helper pure.
- [ ] **Step 4: Run** the api suite; expect PASS.
- [ ] **Step 5: Commit** `fix(api): defined DST behaviour for wall-time reschedules`

### Task 12: Session expiry and remote revoke clear stores; session/tenant repair is safe; Today-card cookie mirror keyed

**Files:**
- Modify: `lib/session-route.ts:75` (`GET /api/session/tenant` becomes `POST` with a form-safe `GET` fallback that never writes), `lib/session.ts:22` (`TENANT_REPAIR_PATH`), the in-memory/localStorage stores cleared on sign-out (find with `grep -rn "clearOnSignOut\|resetStores\|od-today" lib hooks features | head`; Task 2 reset helper is reused), the Today-card cookie mirror (key `od-today-<tenantId>-<userId>`)
- Test: `lib/session-route.test.ts`, `lib/session.test.ts`, `hooks/*.test.ts`

**Interfaces:**
- Produces: `POST /api/session/tenant` (body `{ next }`, same-origin, sets the tenant cookie, 303 to a validated relative path); `GET` of the same path only redirects to `/` and never mutates; `clearClientStores(reason: "sign_out" | "expired" | "revoked" | "tenant_switch"): void` called from every one of those four events.

- [ ] **Step 1: Write the failing tests**
  - `GET /api/session/tenant does not set a cookie`
  - `POST /api/session/tenant sets the cookie only for a membership slug and rejects an absolute next`
  - `session expiry (401 session_expired from the API) clears stores, recents and the Today mirror`
  - `remote revoke detected on the next call clears stores for that device`
  - `tenant switch does not show the previous tenant's Today card from the cookie mirror`
- [ ] **Step 2: Run** `npx vitest run lib hooks` and confirm FAIL.
- [ ] **Step 3: Implement** the route change and the clearing hook; update the `TENANT_REPAIR_PATH` consumers (sign-in form and layout repair) to post. Read the Next route-handler docs first (AGENTS.md).
- [ ] **Step 4: Run** `npx vitest run`, `npm run test:contract`, `npm run build`, Playwright CR-01 and smoke project (`npm run test:e2e`); expect PASS.
- [ ] **Step 5: Commit** `fix(web): clear client stores on expiry and revoke; make tenant repair a POST`

### Task 13: Seed fixes and the demo-seed Docker stage

**Files:**
- Modify: `api/src/seed/demo/wipe.ts` (`--reset` orphans), `api/src/seed/demo/anchor.ts` (latest-report-day anchor), `api/src/seed/demo/seed.ts` and `guards.ts` (advisory-lock timeout), `api/Dockerfile` (new stage `seed`), `.claude/docs/deploy/demo-seed.md`
- Test: `api/src/seed/demo/seed.test.ts`, `anchor.test.ts`, `guards.test.ts`, `cli.test.ts`

**Interfaces:**
- Produces: `--reset` removes every row of a demo tenant including tables added after B6 (the wipe list is derived from `information_schema` tenant_id tables, not a hand list; a test fails when a tenant_id table is not covered); anchor option `--anchor latest-report` aligns the newest mock report day to today; the guard's advisory lock waits at most `SEED_LOCK_TIMEOUT_MS` (default 30000) then exits `refused: lock_timeout`; Dockerfile target `seed` (same deps as `run` plus `tsx`, `CMD ["../node_modules/.bin/tsx","scripts/seed-demo.ts"]`, never the default target).

- [ ] **Step 1: Write the failing tests**
  - `reset leaves no row for any tenant_id table (catalogue-driven)`
  - `a new tenant_id table added to the schema fails the wipe-coverage test until listed or derived`
  - `latest-report anchor makes the newest report date equal today`
  - `a held advisory lock makes the seed refuse with lock_timeout within the timeout`
  - `docker: image target seed builds and has no CMD of the API` (a shell test in `api/test/docker-targets.test.ts` that only parses the Dockerfile; no docker run in unit tests)
- [ ] **Step 2: Run** `npm -w api test -- seed anchor guards cli docker-targets`; confirm FAIL.
- [ ] **Step 3: Implement**; the default `docker build -f api/Dockerfile .` target stays `run` (stage order: deps, run, seed with `run` last-but-one and an explicit `--target` in compose).
- [ ] **Step 4: Run** the seed tests and `docker build -f api/Dockerfile --target seed -t opsdesk-seed:test .` locally if Docker is available (expected: builds; skip with a note when not).
- [ ] **Step 5: Commit** `fix(api): demo seed reset, anchor and lock timeout; add seed image stage`

### Task 14: Isolation walker completeness (routes, tables, platform)

**Files:**
- Create: `api/test/route-inventory.test.ts`, `api/test/platform-isolation.test.ts`
- Modify: `api/test/isolation.test.ts` (header comment, C4 note), `api/test/route-fixtures.ts`
- Test: those files; CI job `api` already runs them

**Interfaces:**
- Produces: `routeInventory(): { method: string; path: string; classification: "tenant-record" | "tenant-static" | "platform" | "public" | "webhook" | "test-only" }[]` (derived from the OpenAPI document, never hand-listed); a manifest `api/test/route-classification.ts` mapping every operation id to its classification with a one-line reason; the test fails on any operation without a classification.

- [ ] **Step 1: Write the failing tests**
  - `every OpenAPI operation is classified (a new route fails the build until classified)`
  - `every tenant-record route is in the isolation walker SPECS or NOT_APPLICABLE with a reason`
  - `every table with tenant_id is touched by at least one walker or control assertion (row-hash coverage list equals the RLS-guard table list)`
  - `platform routes: as tenant A's owner (non-staff) every /v1/platform route is 404 not_found with a body identical to a never-existing route`
  - `platform routes: as staff, {tenantId} routes answer 404 for a nil uuid and never expose another route's tenant secret fields (settings secrets are masked)`
  - `public and webhook routes accept no tenant header and leak no tenant data`
- [ ] **Step 2: Run** `npm -w api test -- route-inventory platform-isolation isolation`; confirm FAIL (the manifest is empty).
- [ ] **Step 3: Implement** the manifest from the current OpenAPI (about 160 operations), then the two test files. Platform: the staff-by-design routes cannot use the A-owner walk (ruling C4); the replacement is the non-staff 404 walk plus the masked-field check, so "walk /v1/platform" means those, and it is blocking in CI like AC-M0-01.
- [ ] **Step 4: Run** the full api suite; expect PASS. CI: make the `api` job name the walker explicitly in a separate step (`npm -w api test -- isolation route-inventory platform-isolation`) so a failure reads as "isolation".
- [ ] **Step 5: Commit** `test(api): complete the isolation gate with a route inventory and platform walk`

### Task 15: Request context, structured logs, metrics and error-reporting hooks

**Files:**
- Create: `api/src/core/observability/{logger.ts,metrics.ts,error-reporter.ts,access-log.ts}`
- Modify: `api/src/app.ts` (middleware order: request id, access log, secure headers), `api/src/server.ts` (metrics port), `api/src/worker.ts` (job metrics and context), `api/src/core/context.ts`, `api/src/deps.ts` (`errorReporter`, `metrics`), the existing `/healthz` and `/readyz`
- Test: `api/src/core/observability/*.test.ts`, `api/src/app.test.ts`

**Interfaces:**
- Produces: `interface ErrorReporter { capture(err: unknown, ctx: { requestId?: string; tenantId?: string; route?: string; jobName?: string }): void }`; `Metrics { counter(name, labels).inc(); histogram(name, labels).observe(sec); render(): string }`; request-scoped `c.get("log")` (pino child with `requestId`, `tenantId`, `userId`, `route` as the route **template**); one access-log line per request: method, route template, status, duration ms, response bytes (no query string, no body, no headers); `GET /healthz` (liveness, no dependencies), `GET /readyz` (Postgres `select 1`, Redis ping, queue reachable; each check named in the JSON, 503 when any fails, no error text); `/metrics` served only on `METRICS_PORT`.
  Metrics: `http_requests_total{method,route,status_class}`, `http_request_duration_seconds{route}`, `db_pool_waiting`, `queue_jobs_total{name,result}`, `queue_job_duration_seconds{name}`, `sweep_tenants_processed{job}`, `event_relay_lag_seconds`, `rate_limited_total{bucket}`. Tenant id is **not** a metric label (cardinality); it is a log and error-reporter field only.

- [ ] **Step 1: Write the failing tests**
  - `every response carries x-request-id and an incoming valid one is reused, an over-long or non-uuid-ish one is replaced`
  - `the access log has route template not the concrete path, and no query string, cookie, authorization header, or body`
  - `a 500 calls errorReporter.capture with requestId and tenantId and the response has no error text`
  - `readyz names each dependency and 503s when redis is down, with no connection string in the body`
  - `metrics render has the listed series and no tenant id label`
  - `log redaction: authorization, cookie, set-cookie, password, token, secret, code fields are redacted in a logged object`
  - `worker job failure logs name, jobId and requestId (when present), never the payload`
- [ ] **Step 2: Run** `npm -w api test -- observability app` and confirm FAIL.
- [ ] **Step 3: Implement**; pino `redact` paths list is one exported constant reused by the seed and the worker; the in-house metrics registry is under 100 lines; the reporter default logs at error with only `err.name` and `cause.code` (the B2 ruling: never Drizzle messages).
- [ ] **Step 4: Run** the api suite; expect PASS. Add `.claude/docs/deploy/observability.md` with the alert rules (5xx rate over 1 percent for 5 min, p95 above 500 ms for 10 min, readyz failing 2 min, queue age above 5 min, relay lag above 30 s, backups older than 26 h).
- [ ] **Step 5: Commit** `feat(api): request context, structured logs, metrics and error-reporting hooks`

### Task 16: Multi-instance read-model cache version stamp and sweep metrics

**Files:**
- Modify: `api/src/modules/read-models/cache.ts`, `api/src/modules/read-models/service.ts`, `api/src/worker.ts` (bust on worker writes), the sweep jobs (batch size and duration metric, ruling S12)
- Test: `api/src/modules/read-models/read-models.test.ts`

**Interfaces:**
- Produces: `bustReadModels(tenantId: string): Promise<void>` (INCR `rm:v:<tenantId>`; still synchronous-safe when Redis is down, falling back to a local drop); cache key includes the stamp; reads cost one Redis GET.

- [ ] **Step 1: Write the failing tests**
  - `a write through instance A is visible to a read on instance B immediately` (two app instances over one fake Redis)
  - `a worker job write invalidates the cache of that tenant`
  - `Redis down: reads fall back to the 30 s TTL and never throw`
  - `a bust for tenant A does not evict tenant B`
- [ ] **Step 2: Run** `npm -w api test -- read-models` and confirm FAIL.
- [ ] **Step 3: Implement** the stamp; keep the existing p95 test of B5 (`read models answer in < 500 ms`) green.
- [ ] **Step 4: Run** the api suite; expect PASS.
- [ ] **Step 5: Commit** `feat(api): redis version stamp for the read-model cache`

### Task 17: k6 load test with documented thresholds

**Files:**
- Create: `load/k6/lib.js`, `load/k6/scenarios.js`, `load/k6/smoke.js`, `load/k6/thresholds.json`, `load/README.md`, `api/scripts/load-prepare.ts` (seeds one tenant with 250 users and 10 000 tasks and writes `load/.users.json` of session cookies, gitignored)
- Modify: `package.json` (`load:prepare`, `load:smoke`), `.github/workflows/ci.yml` (a **manual** `workflow_dispatch` job `load`, not on push)
- Test: `api/scripts/load-prepare.test.ts` (unit: shape of the generated users file, no secrets committed)

**Interfaces:**
- Produces: scenario mix per NFR-08: 250 virtual users through the **BFF** (web origin), ramp 2 min, hold 10 min, ramp down 1 min; weights: dashboard 20 percent, tasks list 25, task detail 15, Today 15, shift report draft save 10, report submit 5, search 5, notifications 5. Thresholds (documented in README and `thresholds.json`): `http_req_duration{kind:read} p(95)<500`, `http_req_duration{kind:write} p(95)<800`, `report submit p(95)<2000` (NFR-08 4G budget measured server side), `http_req_failed rate<0.01`, `checks rate>0.99`, no 429 in the steady state, `db_pool_waiting` p95 0 during the run. Smoke profile: 5 VUs, 1 min, same thresholds, usable in the e2e stack.

- [ ] **Step 1: Write the failing test** `load-prepare produces N users each with a cookie jar entry and tenant slug, and refuses NODE_ENV=production without ALLOW_LOAD_SEED=1`.
- [ ] **Step 2: Run** `npm -w api test -- load-prepare`; confirm FAIL.
- [ ] **Step 3: Implement** the prepare script (reuses the demo seed factories and `withTenant`; never against a database holding a non-load tenant, same guard as the demo seed) and the k6 scripts (cookies per VU from the users file; thinking time 1 to 5 s; `kind` tag per request).
- [ ] **Step 4: Verify** `k6 inspect load/k6/scenarios.js` (script parses) and, when k6 and the e2e stack are available, `npm run e2e:stack && npm run load:prepare && npm run load:smoke`; expect thresholds pass. If k6 is absent the plan records "not run" in the PR text.
- [ ] **Step 5: EXPLAIN pass**: for each of the 8 read queries behind the scenarios run `EXPLAIN (ANALYZE, BUFFERS)` against the prepared tenant (a helper `api/scripts/explain.ts`), record the top three by cost in `load/README.md`, and add an index migration (`0042_*`, numbered by merge order) only for a query with a seq scan over more than 1 000 rows and a proven gain; otherwise write "no change".
- [ ] **Step 6: Commit** `test(load): k6 scenarios and thresholds at 250 users`

### Task 18: Security review checklist, secrets handling, pen-test pack

**Files:**
- Create: `.claude/docs/deploy/security-review.md`, `api/src/env.secrets.test.ts`, `scripts/check-secrets.mjs`
- Modify: `api/src/env.ts` (production refusals), `.github/workflows/ci.yml` (`security` job runs `check-secrets`)
- Test: `api/src/env.test.ts`, `api/src/env.secrets.test.ts`, `scripts/check-secrets.test.ts`

**Interfaces:**
- Produces: production boot refuses (a) `BETTER_AUTH_SECRET` shorter than 32 or equal to any value in an in-repo deny list of example strings, (b) missing `SECRETS_KEY` or `CLAMD_HOST`, (c) `APP_URL` not https, (d) `TRUST_PROXY_HOPS=0` with `NODE_ENV=production` unless `ALLOW_NO_PROXY=1`, (e) `DATABASE_URL` and `DATABASE_OWNER_URL` with the same role; `scripts/check-secrets.mjs` fails on committed high-entropy tokens or the known prefixes (`sk_live`, `sk_test`, `whsec_`, `odk_`, private key blocks) outside `*.test.*` and `*.example`.
  Checklist sections (each a checkbox list with the test or file that proves it): authentication and session (cookies, MFA, session timeout NFR-04, device binding), tenant isolation (the walker, RLS guard), input and output (OpenAPI validation, problem bodies carry no internal text, upload scanning, SSRF guard, download dispositions), edge (proxy overwrite, hop count, headers, CORS only through the BFF), secrets (stored-secret box, key rotation procedure, nothing in logs or bundle), data protection (EU region NFR-02, encryption NFR-03, DSR export/erase, audit chain), dependencies (Task 20), logging (redaction), incident response (NFR-16 template and 72 h clock), and the **external pen-test scope pack** (URLs, roles, test tenants, out-of-scope, contacts blank).

- [ ] **Step 1: Write the failing tests**
  - `production env refuses a weak or example BETTER_AUTH_SECRET`
  - `production env refuses a non-https APP_URL`
  - `production env refuses owner and app database URLs using the same user`
  - `production env refuses TRUST_PROXY_HOPS=0 without ALLOW_NO_PROXY`
  - `check-secrets flags a planted sk_live_ token and passes the repo as is`
  - `a thrown error and a logged object never contain SECRETS_KEY or BETTER_AUTH_SECRET values` (plant the values, trigger a 500 and a log, grep captured output)
- [ ] **Step 2: Run** `npm -w api test -- env` and `npx vitest run scripts`; confirm FAIL.
- [ ] **Step 3: Implement** the refusals and the script; write the checklist and link each item to its proof.
- [ ] **Step 4: Run** both suites, `node scripts/check-secrets.mjs` on the repo (expect exit 0); expect PASS.
- [ ] **Step 5: Commit** `feat(api): production env refusals, secret scan and the security review pack`

### Task 19: Dokploy deploy files and runbooks (documentation and files only)

**Files:**
- Create: `deploy/docker-compose.prod.yml`, `deploy/.env.matrix.example` (names only, empty or `CHANGE_ME` values), `deploy/scripts/restore-drill.sh`, `deploy/scripts/migrate.sh`, `.claude/docs/deploy/{dokploy.md,env-matrix.md,backup-restore.md,migrations.md,rollback.md,runbook-go-live.md}`
- Modify: `Dockerfile` (web) and `api/Dockerfile` only for stage names and healthchecks, `.claude/docs/deploy/b6-cutover.md` (link the new docs, replace the "x-forwarded-for" paragraph with the `TRUST_PROXY_HOPS` rule)
- Test: `api/test/deploy-files.test.ts` (parse-only checks), `deploy/scripts/restore-drill.sh --self-test`

**Interfaces:**
- Produces:
  - Compose services: `web` (root Dockerfile), `api` (`api/Dockerfile` target `run`), `worker` (same image, command `../node_modules/.bin/tsx src/worker.ts`, no published port, healthcheck on a heartbeat key in Redis), `migrate` (one-shot, profile `ops`, runs `deploy/scripts/migrate.sh` as `app_owner`), `seed` (profile `demo`, target `seed`, never started by default), `postgres`, `redis`, `clamav`, `minio` only under profile `local`. Production Postgres and R2 are managed outside the compose file (EU region, NFR-02). Healthchecks: web `GET /sign-in`, api `GET /healthz`, readiness `GET /readyz` for Dokploy's traffic switch.
  - Env matrix table per service (variable, required in prod, secret yes or no, source Dokploy secret store, example shape, rotated how): at least `API_URL`, `APP_ORIGIN`, `ENABLE_MOCK_MODULES`, `APP_URL`, `DATABASE_URL`, `DATABASE_OWNER_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `SECRETS_KEY`, `DATA_REGION`, `TRUST_PROXY_HOPS`, `TENANT_CREATE_MAX_PER_USER`, `METRICS_PORT`, `STRIPE_*`, `RESEND_API_KEY`, `MAIL_FROM`, `S3_*`, `CLAMD_HOST`, `FILE_MAX_BYTES`, `TASK_VIDEO_MAX_BYTES`, `ALLOW_DEMO_SEED`, `SEED_DEMO_PASSWORD`, `SEED_*`, `LOG_LEVEL`.
  - Backups: managed Postgres daily base backup plus WAL for PITR (RPO 1 h means WAL shipping at most every 5 min; document the provider setting to check, with the self-hosted `pgbackrest` alternative), retention 30 days, R2 object versioning on, backups encrypted and in a second EU location; `SECRETS_KEY` and `BETTER_AUTH_SECRET` backed up separately from the data (restoring data without the key makes stored secrets unreadable).
  - Restore drill (NFR-07, quarterly, target RTO 4 h): steps and a script that restores the latest dump into a scratch database, applies nothing, runs `select count(*)` per tenant table against a manifest, runs the audit chain verify for every tenant, and prints elapsed time against the 4 h target; `--self-test` runs it against a Testcontainers or compose Postgres seeded with the demo data.
  - Migrations: order (backup, run `migrate` one-shot with the NEW image as `app_owner`, then roll api and worker, web last), the rule that migrations are additive and backward compatible with the previous image for one release (expand then contract), the `roles.sql` bootstrap and `pg_trgm` pre-enable steps, migration 0020 note, advisory-lock single runner, failure handling.
  - Rollback: image tag pinning, Dokploy rollback of api/worker/web, why DB rollback is restore-based (point-in-time) and when it is allowed, feature flags (`ENABLE_MOCK_MODULES`) and the maintenance page.
  - Edge: proxy overwrites `x-forwarded-for`, hop count check command, `/webhooks/*` route to the API host (B6 cutover), Cloudflare Transform Rule adding `X-Content-Type-Options: nosniff` and the bucket CORS from the cutover doc, HSTS at the proxy, TLS 1.2 minimum (NFR-03), `/metrics` never routed.
  - Go-live runbook: staging first (the same compose, separate database), smoke, k6 smoke, security checklist signed, restore drill done once before client data, first-client steps from the cutover doc section 5, rollback rehearsal, the gate from the roadmap.

- [ ] **Step 1: Write the failing tests** (`api/test/deploy-files.test.ts`)
  - `compose file parses, every service has a healthcheck except one-shot profiles, no secret value is literal`
  - `every env var read by api/src/env.ts and the web (process.env.* outside test) appears in the env matrix doc` (extract names from the zod schema and a grep, compare)
  - `the Dockerfile targets named in compose exist`
  - `docs reference no file path that does not exist` (link check over `.claude/docs/deploy/*.md`)
  - `restore-drill.sh --self-test exits 0 against the compose test database` (skipped with a clear message when Docker is absent)
- [ ] **Step 2: Run** `npm -w api test -- deploy-files` and confirm FAIL.
- [ ] **Step 3: Write** the files and docs; no live calls, no real hostnames, no secrets.
- [ ] **Step 4: Run** the test; `docker compose -f deploy/docker-compose.prod.yml config` with the example env (expect valid); expect PASS.
- [ ] **Step 5: Commit** `docs(deploy): Dokploy compose, env matrix, backup, restore, migration and rollback runbooks`

### Task 20: npm audit triage

**Files:**
- Create: `.claude/docs/deploy/audit-triage.md`
- Modify: root and `api` `package.json` `overrides` only where ruling S15 allows, `.github/workflows/ci.yml` (`security` job)
- Test: `scripts/audit-gate.test.ts` for the small gate script `scripts/audit-gate.mjs`

**Interfaces:**
- Produces: `scripts/audit-gate.mjs`: reads `npm audit --json` and `--omit=dev --json`, exits non-zero for any high or critical in the production tree, prints the dev-tool findings as a table and exits 0; an allowlist file `scripts/audit-allow.json` with `{ advisory, reason, expires }` entries (an expired entry fails).

- [ ] **Step 1: Write the failing tests**
  - `gate fails on a high advisory in the production tree`
  - `gate passes with high advisories only in dev dependencies and lists them`
  - `an allowlist entry silences exactly one advisory until its expiry`
  - `an expired allowlist entry fails the gate`
- [ ] **Step 2: Run** `npx vitest run scripts/audit-gate` and confirm FAIL.
- [ ] **Step 3: Implement** the script; run `npm audit --json` and `npm audit --omit=dev --json`, classify each of the 35 findings (package path, dev or prod, reachable, fix available non-breaking or major) into the triage doc; take only non-breaking patch fixes (`npm audit fix` without `--force`) after the full suites pass; record the `uuid` under `exceljs` (not reached) as an allowlist entry with a 90-day expiry; check `next@16.4.2` advisories against the Next docs in `node_modules/next/dist/docs/` and note the result (the build's "upgrade" block stays treated as untrusted).
- [ ] **Step 4: Run** the gate on the repo (expect exit 0 with a table), then the full root and api suites, `npm run build`; expect PASS.
- [ ] **Step 5: Commit** `chore(security): audit triage and a production-tree audit gate`

---

## Gate (end of B7)

- All 20 tasks merged with task reviews; a final whole-branch review; `npm -w api test` includes the walker, the route inventory and the platform walk; root vitest, contract, Playwright CR-01..06 and the skeleton project green; k6 smoke passes on the e2e stack and the 250-user run meets the thresholds on staging; the restore drill was run once and its time recorded; `.claude/docs/deploy/security-review.md` ticked and handed over as the pen-test scope pack.
- **Not done by this phase:** any live deploy, Stripe live keys, the external penetration test itself, the client sign-off of CR-01..CR-06 (that is the roadmap gate after staging).

## Deferred (listed, not scheduled)

B8 items from the B6 follow-ups (inbox counts, dashboard department filter, `hasVoice`, user deactivate, platform bell, data-request resolve, per-tenant MRR columns); dead webhook delivery replay (S13); audit head anchoring (S13); sweep sharding (S12); PDF Unicode font; Art. 15 export completeness (tracked in the security checklist as an open item with owner); double-click guard on Keep mine / Reload theirs for task conflicts; skeleton drift items; browser walks of the audio player, drag reorder, DST day, Safari/Firefox evidence, real phone camera (go in the staging checklist).
