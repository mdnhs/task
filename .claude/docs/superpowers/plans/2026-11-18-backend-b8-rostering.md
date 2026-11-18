# Backend B8: M1A Rostering (API) and the roster front-end switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read the relevant guide in `node_modules/next/dist/docs/` (route handlers, proxy, data-security, fetching-data, mutating-data, testing/playwright) before any web (Next) change** (AGENTS.md: this Next.js has breaking changes). Each task ends with an independently testable deliverable and its own commit. **Batch nothing silently:** if two tasks look like one, keep two commits and two test runs; if a task turns out too big, split it and say so in the commit message, never fold work into a neighbour.

**Goal:** Give Module 1A (rostering by location, FR-RS-01..44, AC-RS-01..06, CR-07..09) a real backend (locations, shift types, targets, supervisor grants, rosters by week, individual-time shifts, rules, publish and lock, change requests, open shifts, swaps, leave and availability, repeat and templates, history, notifications, audit, coverage and attention read models), switch `features/rosters` from the JSON mock to that API, show the roster screens without `ENABLE_MOCK_MODULES`, and close the B6/B7 carry-ins labelled B8.

**Architecture:** Same layering as B4/B5: `api/src/modules/rosters/*` (service, routes, dto, scope, rules, events), pure logic stays in `packages/domain` (`rosters.ts`, `roster-access.ts`, `roster-rules.ts`, `roster-repeat.ts` already exist and are reused, not rewritten). Every table has `tenant_id` and the R8 RLS template with hand-appended `FORCE ROW LEVEL SECURITY`. Mutations follow: roster advisory lock, `lockActor`, row `FOR UPDATE`, writes, roster history, `notify`, `recordAudit`, `publish` last. Jobs use exactly-once ledgers. The web app reaches the API through the existing BFF and `apiServer()`; types come from `npm run api:types`.

**Tech Stack:** Hono + `@hono/zod-openapi`, Drizzle + Postgres 16 (RLS), BullMQ/Redis, Vitest + Testcontainers (api), Next.js 16 (web, BFF), Playwright.

**Spec:** `.claude/docs/requirements/SRS.md` §5A (FR-RS-01..45, AC-RS-01..06), §5.1 CR-07..09, NFR-03/05/06/07/08, Appendix A.7 (build status), A.8 decisions 1, 3, 4, 6; `.claude/docs/superpowers/specs/2026-11-09-module-1a-rostering-design.md` (D1..D13); `.claude/docs/features/rosters.md`; `.claude/docs/superpowers/plans/2026-11-16-hono-backend-roadmap.md` (B8 line; B9 consumes `roster.published`, B11 owns staff-rosters incident/cover); `2026-11-18-backend-b7-followups.md` and `2026-11-18-backend-b6-followups.md` ("Carry to B8" lines are mandatory scope: Tasks 1, 6, 15, 16, 17, 24); `.claude/docs/deploy/` (migrations.md rules 1-3, demo-seed.md, runbook-go-live.md).

## What is NOT B8 (do not build)

- **B9** Time and Attendance (clock in/out, no-shows, lateness, corrections, timesheets, kiosk). FR-RS-39 is met by locking nothing outside the roster (A.8 #4); B8 only emits `roster.week_published` / `roster.shift_changed` for B9 to consume.
- **B10** Payroll (labour cost FR-RS-14 included: deferred with the rest of payroll).
- **B11** the Staff & Rosters incident and cover-gap model, Orders and Stock, client files and employee documents, recruitment. These stay hidden behind `ENABLE_MOCK_MODULES` and are never deleted (project memory: keep extra features).
- Deferred inside M1A: FR-RS-13 (PDF/Excel export), FR-RS-14 (labour cost), FR-RS-22 rotating pattern, FR-RS-25 (roster shifts feeding shift reports, see R8-14), FR-RS-45 (Module 2 suggestions), a calendar **subscription** URL (download of `.ics` only).

## Rulings (made for B8; binding for later phases)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R8-1 | **DST alignment (the `wallToEpoch` decision).** One rule for the whole product, the B7 S9 rule: a wall time that does not exist (spring forward) resolves to the first valid minute after the gap (the transition instant); a wall time that happens twice (fall back) takes the first occurrence. It moves into `@opsdesk/domain` `wallToEpoch` itself, and the API's `instantOfWall` becomes a thin validator around it (one implementation). Rosters, shift patterns, report deadlines, Today and tasks then agree. The old "shift forward by the gap length" is gone: 01:30 in the Dublin gap is 02:00 (not 02:30). | Roster rules (rest, 48 h, double booking) compare instants; two rules for one wall time would make the same shift count differently in tasks and rosters. | Past rows keep their stored instants (nothing is recomputed); only a not-yet-stored wall time inside a gap changes by up to the gap length. Task 1 queries for stored gap-night rows and lists them. |
| R8-2 | Roster wall times (`date`, `start`, `end`) are read in the **location's zone** (`locations.time_zone`, null = the tenant zone). Each shift stores `start_at`/`end_at` (timestamptz) computed on write with `wallToEpoch`; the wall strings stay the source for display. A shift counts on the day it starts (FR-RS-21). Changing a location's zone recomputes **draft** shifts only; published shifts keep their instants. | FR-RS-21; the tenant zone is never hard-coded. | A zone change after publish needs a change request per shift (acceptable: rare). |
| R8-3 | `roles.roster_level` (`'office' \| 'supervisor' \| null`) is the API form of the mock's `Role.rosterLevel`. Template roles are backfilled by key (owner, admin, roster-manager: office; location-supervisor: supervisor). Level only matters when `access.roster` is `read` or `write`. `@opsdesk/domain` `rosterAccess` is reused through an adapter (`rosterScope`), never copied. | The scope rules (D4, D5) already exist and are tested; the API must not diverge. | none |
| R8-4 | A location the caller may not see is **404** (never 403), on every route, nested ones included. Lists are cut by `location_id` in the caller's scope in SQL, not after loading. Rule messages and history for hidden sites are masked ("Already rostered elsewhere"). | AC-RS-03, AC-M0-01. | none |
| R8-5 | **One roster writer per tenant**: advisory lock `ROSTER_LOCK_NS = 0x726f7374` ("rost") with `hashtext(tenantId)`, taken first. Cross-location rules (a person double-booked at two sites) need a consistent read of the person's other shifts; a per-location lock cannot give that. | Same reasoning as `SHIFT_LOCK_NS`; one client. | Revisit when one tenant has more than 20 concurrent roster editors. |
| R8-6 | Qualifications are M1A-owned rows (`member_qualifications`: `type` text key, optional `expires_on`, optional `file_id` for B11 documents to link later). `shift_types.requires` lists qualification types; "only qualified staff are suggested" (FR-RS-04) and the `expired_licence` rule read the same rows. An expiry sweep (job, ledger) notifies at the tenant's lead days (setting, default 30 and 7). | SRS puts the licence rule in M1A (FR-RS-04, 44); employee documents are B11. | B11 adds a link, not a migration of data. |
| R8-7 | **Leave is owned by M1A when entitled** (A.8 #3): `leave_requests`, approved by a supervisor of the person's home location else an office role (D8), never the requester. A tenant without M1A gets 403 `module_not_entitled` on leave routes (Module 4 is not built). Availability is a "not available" window per weekday (the mock's shape). | A.8 #3. | M4 later reads the same table. |
| R8-8 | Publish and lock: `roster_weeks.status` `draft \| published`, no unpublish (D7). A supervisor writing to a published week gets **403 `roster_locked`**; an office role needs a `reason` (422 `reason_required`). The lock covers roster rows only. | FR-RS-35..37, AC-RS-05. | none |
| R8-9 | Concurrency: `roster_weeks.version` and `roster_shifts.version` are optimistic locks (`409 version_conflict`, `409 retry` once, as B4). Publish and repeat send the week `version`. | Two editors on one week. | none |
| R8-10 | Rule engine: warnings never stop a publish; a **block**-severity violation needs an office role plus a reason (override recorded in history and audit); a supervisor can never publish over a block. Default severities are data (tenant setting `roster.rules`), not code. | FR-RS-44; mock D9. | none |
| R8-11 | An open shift is a `roster_shifts` row with `user_id` null. Claims and swaps are one table `roster_exchanges` (`kind` `claim \| swap`). Approval: supervisor on a draft week, office on a published week unless `locations.swap_approval_delegated` (FR-RS-38, 42, 43, A.8 #6). Nobody approves their own. | One approval path, one history. | none |
| R8-12 | Repeat (FR-RS-26..28): all-or-nothing per request, target must be a Monday, a published target is 409 `week_published`, a draft target needs `replace: true`. Each copied shift is re-checked: **block** violations become open shifts plus a conflict row, **warn** keeps the person with `open: false`, a public holiday is an information line only. Auto-repeat creates a **draft** and notifies the location's supervisors, once per `(source week, target week)` (ledger). | FR-RS-26..28, mock D10. | none |
| R8-13 | Every roster mutation writes **both** `roster_history` (user-facing, FR-RS-24/37, keeps the whole shift as `before`) and the hash-chained audit (security view). History carries user ids, never names (erasure-safe). | NFR-05. | none |
| R8-14 | **Roster does not feed shift reports in B8.** The B6 I17 drop stays: reports and Today use the API's patterns only. FR-RS-25 is deferred and documented; `roster.week_published` carries `{weekId, locationId, weekStart, shiftIds}` so B9 (and a later reports plan) can consume it. | A roster shift has no `shift_patterns` row; reports FK a pattern. Making reports accept a second occurrence source is a B5 schema change that belongs with B9's attendance decision. | The demo roster does not prefill reports until B9. |
| R8-15 | Staff & Rosters (incident and cover model) stays mock, hidden by the flag, until B11. B8 removes only its read of the roster seed (derived "From roster" gaps), not the feature. | Never remove it; the API for cover is B11. | The "From roster" gaps disappear from that hidden page. |
| R8-16 | `.ics` is generated by the **API** (`GET /v1/roster/mine.ics`), UID = `<shift uuid>@<host>` so it is tenant-unique, UTC times, CRLF, 75-octet folding (port of `lib/ics.ts` into domain, one builder, parity test). | Closes the "UID not tenant-unique" minor and removes browser-side time logic. | none |
| R8-17 | Notification dedupe: one "roster published" notification per person per week (batched, sent in the publishing transaction's `notify`), one "shift changed" per person per mutation. Staff must confirm again after an office edit to their shift (`confirmed_at` cleared for that person only). | FR-RS-23, 37. | none |
| R8-18 | Roster DTO ids are uuids; the web URL `?location=&week=` carries the location uuid and the week start date. The demo seed maps `loc-*`/`w-*` seed ids to uuids. | I11 (ids and refs) for the same reason. | none |
| R8-19 | Erasure (F22): `roster_shifts.user_id` is `ON DELETE SET NULL (user_id)` (column-list form, Postgres 15+): the shift survives as an open shift, history keeps ids. Leave, availability, qualifications and exchanges of the person cascade. GDPR export includes the person's roster rows (Task 18 test). | Shifts are the location's record, leave is personal data. | none |
| R8-20 | Order is by risk: DST rule (1), schema and RLS (2, 3), scope (4), then writes from safest to riskiest (5 to 14), API carry-ins (15 to 17), seed and evidence (18), then front-end (19 to 25), gate (26). | A scope or lock bug leaks or corrupts data; a skeleton does not. | none |

## Global Constraints

- All B0 to B7 constraints hold: problem+json everywhere; cross-tenant or out-of-scope id answers 404 (never 403); module not in plan 403 `module_not_entitled` (`requireModule("M1A")` on every roster route); unpaid 402 `billing_required` on non-GET; `409 retry` repeats once; `deps.clock` is the only clock (`new Date()` and `Date.now()` are banned in `api/src/modules/rosters`, a source-grep test enforces it); R8 RLS template on every new table with `FORCE ROW LEVEL SECURITY` appended by hand; every JSON body has `.openapi({ example })`; audit for every security-relevant write; Postgres is 16.
- Mutation order inside a transaction: `lockRoster` (R8-5), then `lockActor`, then row `FOR UPDATE`, then writes, then roster history, then `notify`, then `recordAudit`, then `publish` last. Exactly-once jobs use a ledger with a unique key (the B5 deadline job is the template).
- **Migrations** are numbered from `0043`, run as `app_owner`, additive (docs/deploy/migrations.md). Every migration touching FORCE RLS tables is tested by running the **real SQL as app_owner without tenant context** (the 0040/0041 lesson: a plain UPDATE matches 0 rows and reports success), a backfill loops tenants with `set_config('app.tenant_id', id, true)`, **resets `app.tenant_id` to '' after the loop**, and the test asserts a count of backfilled rows over more than one tenant.
- **Isolation (T7.1 gate).** Every new route is added to `api/test/route-classification.ts` in the same commit (the inventory test fails otherwise); every path-param route gets `ROUTE_PARAMS`/`SPECS` fixtures in `api/test/isolation.test.ts` and `route-fixtures.ts` with a tenant-B id; every new table is added to `HASHED_TABLES` in `api/test/isolation-tables.ts` (the inventory test requires `HASHED_TABLES + TABLE_EXEMPT` to equal the live list of `tenant_id` tables).
- Never hard-code tenant values (company, locations, departments, deadline, timezone, branding, rule thresholds that a tenant may change). The legal constants of FR-RS-44 (11 h rest, 24 h weekly rest, 48 h average) stay in domain as named constants; their severity and the averaging window are settings. Ismail, Coppers and the demo names appear only in the seed and in tests.
- Web: OpsDesk tokens, borderless, big radius, no shadcn defaults (`.claude/docs/00-design-system/ui-rules.md`); compact visual UI (icons, numbers, short copy); hover, disabled, read-only and open states checked in light and dark (hover on card rows is text colour only); motion tokens, CSS first, `motion/react` only where ui-rules allows; every page and component has an exact-match skeleton (`features/<f>/components/skeletons.tsx`, `loading.tsx` static per K1, built with `Sk`, update it whenever its component changes); features import each other only through `index.ts`; `loading.tsx` never calls the API (I9).
- After every task: `npm -w api test`, `npm -w api run typecheck`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 errors, 27 warnings baseline), `npm run api:types:check` (run `npm run api:types` when the OpenAPI document changed and commit the result), `npm run test:contract` for any change a contract test covers, `npm run build` and `npm run check:bundle` for any web change. Baselines to hold or raise: root vitest 1724, contract 41, api 1374.
- Docs: `.claude/docs/features/rosters.md` gets a "Backend notes (B8)" section as it goes (Task 26 consolidates); no new `.md` file except where a task names it.

## Review Focus

1. A location supervisor, an office roster manager with an `except` list, a staff member and a platform user each hit every roster route with ids from another location and from another tenant: 404 or an empty cut list, no other site's name, shift id, person, history line or count in any JSON body (lists, rule messages, history, coverage, attention, notifications, `.ics`). Test owners: Tasks 4, 8, 14, 26.
2. A published week cannot be changed by a supervisor through **any** route (add, move, remove, claim approve, swap approve, repeat target, template apply, change of a shift type's times), and an office edit always leaves who/when/old/new/reason. Test owner: Task 10 (matrix test over every mutating route), re-asserted in Tasks 11, 12, 13.
3. Clock-change nights: a 22:00 to 06:00 shift on Sat 24 Oct 2026 (Europe/Dublin) is 9 real hours on the start day, rest between two shifts across the change is real elapsed time, a start inside the 29 Mar 2026 gap resolves to 02:00 IST and a start in the 25 Oct 2026 fold takes the first occurrence, in rules, publish check, repeat and `.ics`. Test owners: Tasks 1, 8, 13, 14.
4. Two editors, a double click and a retried request: no duplicate shift, no double publish, no second auto-repeat draft, no duplicate notification, version conflict shown not swallowed. Test owners: Tasks 9, 10, 12, 13.
5. Repeat and publish never silently drop or invent a shift: every copied shift is either kept, kept with a warning line, or an open shift with a conflict row. Test owner: Task 13.

---

## File structure (new or changed, by responsibility)

- `packages/domain/src/shifts.ts` (wallToEpoch rule), `packages/domain/src/ics.ts` (new, moved from `lib/ics.ts`), `packages/domain/src/rosters.ts` and `roster-*.ts` (reused; small additions named in tasks).
- `api/src/db/schema/rosters.ts` (new), `api/src/db/schema/index.ts`, `api/src/db/migrations/0043..0047_*.sql` (+ drizzle meta).
- `api/src/modules/rosters/`: `scope.ts` (access + `lockRoster`), `locations.ts`, `qualifications.ts`, `leave.ts`, `rules.ts`, `weeks.ts`, `shifts.ts`, `publish.ts`, `requests.ts`, `exchange.ts`, `repeat.ts`, `jobs.ts`, `mine.ts`, `read-model.ts`, `history.ts`, `dto.ts`, `events.ts`, `routes.ts`, `index.ts`, `rosters.test.ts` (split per task).
- `api/src/modules/read-models/` (coverage and attention items), `api/src/modules/shift-reports/inbox.ts`, `api/src/modules/platform-console/`.
- `api/test/` (isolation fixtures, classification, tables), `api/src/seed/demo/` (roster seeding), `load/k6/` (roster scenario).
- Web: `features/rosters/{api.ts,types.ts,adapters.ts,actions.ts,components/*,view.ts}`, `app/(app)/rosters/**`, `app/actions/rosters.ts`, `lib/mock-registry.ts`, `features/staff-rosters/`, `e2e/cr07.spec.ts`, `e2e/cr08.spec.ts`, `e2e/cr09.spec.ts`, `e2e/skeletons.spec.ts`, `scripts/smoke/rosters.json`.

---

## Part A: API

### Task 1: DST alignment in `wallToEpoch` (ruling R8-1)

**Files:** Modify `packages/domain/src/shifts.ts` (`wallToEpoch`, header comment), `api/src/modules/tasks/time.ts` (`instantOfWall` delegates), `api/src/modules/tasks/recurrence.ts` (comment at line 35), `lib/ics.ts` and `api/src/seed/demo/anchor.ts` (only if a test pins the old value). Test: `packages/domain/src/shifts.test.ts`, `report-deadline.test.ts`, `today.test.ts`, `api/src/modules/tasks/time.test.ts`, `api/src/modules/shift-reports/reports.test.ts` where they pin gap behaviour.

**Interfaces:** `wallToEpoch(wall: string, tz: string): number` keeps its signature; new behaviour per R8-1. `epochToWall`, `addMinutes`, `minutesBetween` unchanged. `instantOfWall(w, tz): Date` keeps 422 `invalid_dates` for malformed input, otherwise calls `wallToEpoch`.

- [ ] **Step 1: Write the failing tests** (domain `shifts.test.ts`):
  - `gap: 01:30 on 29 Mar 2026 in Europe/Dublin resolves to the transition instant 01:00Z (wall 02:00)`
  - `gap: a 30-minute-gap zone (Australia/Lord_Howe, 5 Oct 2025) resolves to the first valid minute after the gap`
  - `fold: 01:30 on 25 Oct 2026 takes the first occurrence (00:30Z)`
  - `a wall time on the first minute after the gap is unchanged`
  - `minutesBetween across the spring gap counts real minutes (22:00 on 28 Mar to 06:00 on 29 Mar 2026 is 420)`
  - `occurrenceInstants: a 01:30-09:30 pattern on 28 Mar 2027 starts at 01:00Z` (replaces the pin at line 392; update the expected end and minutes by hand and state why in the test name)
  - `instantOfWall and wallToEpoch agree for every minute of 28-30 Mar 2026 and 24-26 Oct 2026 (property sweep, Dublin and New_York)`
  - Update the two existing pins (`spring-forward gap moves forward` expects `...T02:00`) and any consumer test that fails, with a one-line reason each.
- [ ] **Step 2: Run** `npx vitest run packages/domain api/src/modules/tasks` expecting FAIL on the gap tests.
- [ ] **Step 3: Implement** in domain only (the gap search moves from `tasks/time.ts` into `shifts.ts`, same bisect, no I/O). `instantOfWall` keeps only `validWall` plus the call. Do **not** touch `epochToWall` or fold behaviour.
- [ ] **Step 4: Stored-data check.** Add `api/scripts/` read-only query (or a documented SQL in the task commit) listing `shift_reports`, `task` instants and report ledger rows whose wall time falls in a gap night; record the result in `.claude/docs/deploy/migrations.md`-style note inside the commit message (expected none for a first client). No data rewrite.
- [ ] **Step 5: Run** the full gates; the report-deadline, today, shift-report and tasks suites must be green with only the intended pin changes.
- [ ] **Step 6: Commit** `fix(domain): wallToEpoch uses one DST rule for rosters, shifts, deadlines and tasks (R8-1)`

### Task 2: Migration 0043: locations, access, shift types, targets, qualifications, role level

**Files:** Create `api/src/db/schema/rosters.ts` (part 1), `api/src/db/migrations/0043_roster_locations.sql` (+ meta); modify `api/src/db/schema/tenants.ts` (`roles.rosterLevel`), `api/src/db/schema/index.ts`, `api/test/isolation-tables.ts`. Test: `api/src/modules/rosters/schema.test.ts`, `api/test/rls-guard.test.ts` stays green.

**Interfaces (Produces):** tables `locations`, `location_supervisors`, `roster_office_limits`, `shift_types`, `shift_type_targets`, `member_qualifications`; column `roles.roster_level text null check in ('office','supervisor')`.
- `locations(id, tenant_id, name, address, lat, lng, zone_radius_m, opening_hours, contact, swap_approval_delegated, time_zone null, version, archived_at, created_at, updated_at)`, unique `(tenant_id, id)`, unique active name per tenant, checks on name length, radius range (0..5000), lat/lng ranges, `time_zone` valid IANA is validated in the service.
- `location_supervisors(tenant_id, location_id, user_id, created_by, created_at)` PK `(tenant_id, location_id, user_id)`, composite FKs to `locations` and `memberships` (cascade on membership delete).
- `roster_office_limits(tenant_id, user_id, location_id)`: a Roster Manager's "all except" list.
- `shift_types(id, tenant_id, location_id, name, start_time, end_time, unpaid_break_min, role, requires text[], archived_at, version, ...)` with the HH:MM checks of `shift_patterns`; `shift_type_targets(tenant_id, shift_type_id, weekday smallint, count smallint)` PK `(tenant_id, shift_type_id, weekday)`.
- `member_qualifications(id, tenant_id, user_id, type, expires_on date null, file_id uuid null, created_by, ...)` unique `(tenant_id, user_id, type)`.

- [ ] **Step 1: Write the failing tests** (`schema.test.ts`, Testcontainers):
  - `every new table has RLS enabled and FORCED and the tenant_isolation policy (catalog query)`
  - `app_user without tenant context reads zero rows of each new table`
  - `app_user in tenant A cannot insert a row with tenant B's tenant_id (WITH CHECK)`
  - `a composite FK refuses a supervisor row whose location belongs to another tenant`
  - `deleting a membership cascades its supervisor grant, office limit and qualifications`
  - `shift_type end may equal start only through the overnight rule (no CHECK on end > start)`
  - `migration 0043 backfill: roles.roster_level is set for template roles of 3 tenants, run as app_owner WITHOUT tenant context in the test, count asserted per tenant, app.tenant_id is '' afterwards` (assert `current_setting('app.tenant_id', true)` is empty after the migration block)
  - `roster_level check rejects an unknown value`
- [ ] **Step 2: Run** `npm -w api test -- schema` and confirm FAIL.
- [ ] **Step 3: Implement** schema, SQL (template R8 policy + `ALTER TABLE ... FORCE ROW LEVEL SECURITY` per table, grants follow the 0000 default privileges), backfill by role `key` in a per-tenant loop with the reset at the end. Add the six tables to `HASHED_TABLES`.
- [ ] **Step 4: Run** the gates incl. `api/test/route-inventory.test.ts` (tables list) and `rls-guard.test.ts`.
- [ ] **Step 5: Commit** `feat(api): roster locations, supervisor grants, shift types, targets and qualifications schema with RLS`

### Task 3: Migration 0044: weeks, shifts, history, requests, exchanges, leave, availability, templates

**Files:** Modify `api/src/db/schema/rosters.ts` (part 2), create `api/src/db/migrations/0044_roster_weeks.sql`; modify `api/test/isolation-tables.ts`, `api/src/core/events/types.ts` (event types of Tasks 10 to 14, added here so later tasks compile), `api/src/modules/gdpr` table list if it enumerates tables. Test: `api/src/modules/rosters/schema2.test.ts`.

**Interfaces (Produces):**
- `roster_weeks(id, tenant_id, location_id, week_start date (CHECK isodow = 1), status 'draft'|'published', published_at, published_by, auto_repeat_days smallint null, version, created_at, updated_at)` unique `(tenant_id, location_id, week_start)`.
- `roster_shifts(id, tenant_id, week_id, location_id, date, user_id text null, shift_type_id, role, start_time, end_time, unpaid_break_min, start_at, end_at, confirmed_at null, version, source_shift_id null, created_by, ...)`; composite FKs to week, location, shift type (no cascade), membership `ON DELETE SET NULL (user_id)`; indexes `(tenant_id, user_id, start_at)`, `(tenant_id, location_id, date)`, `(tenant_id, week_id)`; check `end_at > start_at`.
- `roster_history(id, tenant_id, week_id null, location_id, shift_id null, action, actor_id, reason null, before jsonb, after jsonb, created_at)` index `(tenant_id, location_id, created_at desc, id desc)`.
- `roster_change_requests(id, tenant_id, shift_id, requested_by, patch jsonb, reason, status 'requested'|'approved'|'rejected', decided_by, decided_at, decision_note, ...)`.
- `roster_exchanges(id, tenant_id, kind 'claim'|'swap', shift_id, from_user_id, to_user_id null, status 'requested'|'recommended'|'approved'|'rejected'|'cancelled', note, decided_by, decided_at, ...)`; partial unique: one open exchange per (shift, from user, kind).
- `leave_requests(id, tenant_id, user_id, from_date, to_date, kind, status 'requested'|'approved'|'rejected'|'cancelled', note, decided_by, decided_at, ...)` check `to_date >= from_date`.
- `roster_availability(tenant_id, user_id, weekday, from_time, to_time)` (a "not available" window; overnight stored as two rows by the service).
- `roster_week_templates(id, tenant_id, location_id, name, shifts jsonb, created_by, ...)` unique `(tenant_id, location_id, name)`.
- Ledgers: `roster_auto_repeat_runs(tenant_id, source_week_id, target_week_start, created_at)` PK on the three; `qualification_expiry_notices(tenant_id, user_id, type, expires_on, lead_days)` PK on all.

- [ ] **Step 1: Write the failing tests** (RLS and constraints as in Task 2, plus):
  - `roster_weeks.week_start must be a Monday (CHECK)`
  - `a second week for the same location and start is refused (unique)`
  - `deleting a membership sets roster_shifts.user_id to NULL and keeps tenant_id (column-list SET NULL)`
  - `end_at must be after start_at`
  - `a second open exchange for the same shift and requester is refused, a decided one does not block a new one`
  - `ledger tables refuse a duplicate key`
  - `app_owner with no tenant context sees 0 rows through the policy, real migration SQL replayed as app_owner leaves app.tenant_id empty`
- [ ] **Step 2: Run** and confirm FAIL. **Step 3: Implement** SQL with FORCE RLS; add the 8 tables to `HASHED_TABLES`; add the event types `roster.week_published`, `roster.shift_changed`, `roster.change_requested`, `roster.change_decided`, `roster.exchange_requested`, `roster.exchange_decided`, `roster.leave_requested`, `roster.leave_decided`, `roster.auto_repeat_created`, `roster.qualification_expiring`, `location.supervisors_changed`, `member.deactivated` to the union.
- [ ] **Step 4: Run** the gates. **Step 5: Commit** `feat(api): roster weeks, shifts, history, requests, exchanges, leave and availability schema with RLS`

### Task 4: Roster scope and the roster lock (the access boundary)

**Files:** Create `api/src/modules/rosters/scope.ts`, `index.ts`; test `api/src/modules/rosters/scope.test.ts`.

**Interfaces (Produces):**
```ts
export const ROSTER_LOCK_NS: 0x726f7374
export function lockRoster(tx: TenantTx, tenantId: string): Promise<unknown>
export type RosterCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; access: RosterAccess; now: Date }
export async function loadRosterCtx(c: Context<AppEnv>, tx: TenantTx, need?: "read" | "write"): Promise<RosterCtx>
export function assertLocation(ctx: RosterCtx, locationId: string): void   // throws NotFound (404) when not visible
export function inScopeSql(ctx: RosterCtx, column: AnyColumn): SQL          // `location_id IN (...)` or true for scope "all"
export function weekEditGate(ctx: RosterCtx, week: { status: "draft" | "published" }, reason?: string): void // R8-8: 403 roster_locked / 422 reason_required
export const rosterGuard: (need: "read" | "write") => MiddlewareHandler[]   // requireTenant, requireModule("M1A"), requirePermission("roster", need)
```
Adapter reads `roles.roster_level`, `location_supervisors`, `roster_office_limits` and calls domain `rosterAccess`.

- [ ] **Step 1: Write the failing tests:**
  - `owner and admin get scope all, editPublished true`
  - `roster manager with an except list sees every location except those, assertLocation throws 404 for an excepted one`
  - `location supervisor sees only granted locations; a supervisor with no grants sees none`
  - `manager-home read role: scope all, no edit flags`
  - `staff-home role: scope own (no location listing)`
  - `weekEditGate: supervisor on a published week is 403 roster_locked; office without reason is 422 reason_required; office with reason passes; supervisor on a draft passes`
  - `inScopeSql builds the same cut the adapter returns (property over 3 roles x 3 locations)`
  - `a role without access.roster (none) gets 403 on a guarded probe route; a tenant without M1A gets 403 module_not_entitled`
  - `source grep: no new Date( or Date.now( in api/src/modules/rosters`
- [ ] **Step 2: Run** and confirm FAIL. **Step 3: Implement** (read `api/src/modules/shifts/scope.ts` for the `lockActor` and re-read-in-tx pattern, R25). **Step 4: Run** gates. **Step 5: Commit** `feat(api): roster scope, location access boundary and roster lock`

### Task 5: Locations, shift types, targets, supervisor grants, office limits (FR-RS-01..04, 30..34)

**Files:** `api/src/modules/rosters/locations.ts`, `dto.ts`, `routes.ts`; modify `api/test/route-classification.ts`, `route-fixtures.ts`, `isolation.test.ts`; test `locations.test.ts`.

**Interfaces:** routes `GET /v1/locations` (cut by scope), `POST /v1/locations`, `GET /v1/locations/{id}`, `PATCH /v1/locations/{id}` (body `version`), `POST /v1/locations/{id}/archive`, `PUT /v1/locations/{id}/supervisors` (`{ userIds }`), `GET|POST /v1/locations/{id}/shift-types`, `PATCH|DELETE /v1/shift-types/{id}` (DELETE archives; 409 `shift_type_in_use` is NOT used, archive always succeeds and in-use types stay readable), `PUT /v1/shift-types/{id}/targets` (`{ targets: [{ weekday, count }] }`), `PUT /v1/roster/office-limits/{userId}` (`{ except: locationIds }`). Writes are office-level only (supervisors read their granted locations). Events `location.supervisors_changed`; audit `roster.location_created|updated|archived`, `roster.supervisors_changed` (FR-RS-34, old and new set), `roster.office_limit_changed`.

- [ ] **Step 1: Write the failing tests:**
  - `office creates a location; supervisor POST is 403; staff is 403`
  - `AC-RS-03: a supervisor GET /v1/locations lists only the granted one; GET another location id is 404; the body of every response has no other location's name`
  - `PATCH with a stale version is 409 version_conflict; two concurrent PATCH: exactly one wins`
  - `time_zone must be an IANA zone; radius over 5000 is 422`
  - `supervisor change writes an audit row with the old and new user ids and publishes location.supervisors_changed once; an unchanged set writes nothing`
  - `assigning a supervisor who is deactivated or not a member is 422`
  - `a shift type in use by a shift cannot be hard-deleted: DELETE archives it, the roster still shows it`
  - `shift type start equal to end is allowed (overnight 24 h is not): 22:00-06:00 is overnight, 08:00-08:00 is 422`
  - `office limit: a roster manager with an except list no longer lists or reads that location; limits for a user who is not roster office level are 422`
  - `qualification types in requires are free text keys, trimmed, deduplicated, max 20`
  - isolation walker rows for `/v1/locations/{id}`, `/v1/shift-types/{id}`, `/v1/roster/office-limits/{userId}` (tenant-B id answers 404)
- [ ] **Step 2: Run** and confirm FAIL. **Step 3: Implement** (all writes in the Task 4 order; archive instead of delete). **Step 4: Run** gates incl. `api:types`. **Step 5: Commit** `feat(api): locations, shift types, staffing targets, supervisor grants and office limits`

### Task 6: Member lifecycle carry-in: deactivate, last active, qualifications, home location

**Files:** `api/src/modules/rosters/qualifications.ts`; modify `api/src/modules/rbac` or `teams` member routes (read where `PATCH /v1/members/{userId}` lives), `api/src/db/migrations/0045_member_lifecycle.sql` (`memberships.deactivated_at`, `memberships.last_active_at`, `memberships.home_location_id` with composite FK to `locations`), test `members-lifecycle.test.ts`, `qualifications.test.ts`.

**Interfaces:** `POST /v1/members/{userId}/deactivate` and `/reactivate` (owner or admin, last-owner guard as B1, sessions revoked, audit `member.deactivated`); `GET /v1/people` gains `lastActiveAt`, `status`; `last_active_at` is stamped from the session middleware at most once per 5 minutes per user (single `UPDATE ... WHERE last_active_at < now()-interval` through `deps.clock`, never on the response hot path: fire-and-forget with error swallow and a metric); `GET|PUT /v1/members/{userId}/qualifications` (`[{ type, expiresOn }]`, read: self, office, supervisors of the person's locations; write: office only); `PUT /v1/members/{userId}/home-location`. A deactivated member is the `left` rule's input (`leftOn = deactivated_at date in the tenant zone`).

- [ ] **Step 1: Write the failing tests:**
  - `deactivate revokes the member's sessions, blocks sign-in to the tenant, keeps their history and shifts; reactivate restores`
  - `the last active owner cannot be deactivated (422 last_owner)`
  - `a deactivated member's future draft shifts are untouched but flagged by the left rule (Task 8 asserts)`
  - `last_active_at moves at most once per 5 minutes and never makes a request fail when the update errors`
  - `GET /v1/people returns lastActiveAt null for a member never seen`
  - `qualifications: office writes, supervisor reads only people homed or rostered at their locations, staff reads own; another tenant's userId is 404`
  - `expired type shown with expired true computed on the clock`
  - `home-location set to a location the caller cannot see is 404`
  - `migration 0045 test: runs as app_owner with no tenant context, adds nullable columns, does not touch existing rows`
  - isolation fixtures for `/v1/members/{userId}/...`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): member deactivate, last-active, qualifications and home location`

### Task 7: Leave and availability (FR-RS-41, R8-7)

**Files:** `api/src/modules/rosters/leave.ts`, routes; test `leave.test.ts`.

**Interfaces:** `GET /v1/leave?status=&userId=&from=&to=` (own; supervisor: people homed at their locations; office: all within scope), `POST /v1/leave` (self; body `{ from, to, kind, note }`), `POST /v1/leave/{id}/cancel`, `POST /v1/leave/{id}/decide` (`{ decision: "approve"|"reject", note }`), `GET|PUT /v1/roster/availability` (self; `{ windows: [{ weekday, from, to }] }`, overnight windows split at midnight by the service). Approver rule (D8): supervisor of the person's `home_location_id`, else an office role whose scope covers the person's home (a Roster Manager with an `except` never decides for someone homed at the excepted site); nobody decides their own. Events `roster.leave_requested`, `roster.leave_decided`; notifications to approvers and the requester; audit on decide.

- [ ] **Step 1: Write the failing tests:**
  - `staff creates leave; overlapping own approved leave is 409 leave_overlap`
  - `supervisor of the home location approves; a supervisor of another location gets 404 for that leave`
  - `office role approves for a person homed nowhere; an office role with an except list cannot decide for someone homed at the excepted site (404)`
  - `nobody decides their own leave (403)`
  - `decide twice is 409 already_decided; two concurrent decides: one 200 one 409`
  - `approved leave is returned by the rule context loader (Task 8) and never reaches a caller outside scope`
  - `leave routes on a tenant without M1A are 403 module_not_entitled`
  - `availability PUT replaces the set atomically; an overnight window 22:00-06:00 stores two rows; invalid windows are 422`
  - `notification to approvers names no other site's people`
  - isolation fixtures for `/v1/leave/{id}`, `/cancel`, `/decide`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): leave requests, approval and availability for rostering`

### Task 8: Server rule engine, settings and the check endpoint (FR-RS-44)

**Files:** `api/src/modules/rosters/rules.ts`; settings key `roster.rules` through the existing settings module; modify `packages/domain/src/roster-rules.ts` only if a gap below needs it; test `rules.test.ts`.

**Interfaces:**
```ts
export async function loadRuleContext(tx: TenantTx, ctx: RosterCtx, opts: { weekIds?: string[]; from: string; to: string }): Promise<RuleContext>
export async function checkWeek(tx: TenantTx, ctx: RosterCtx, weekId: string, extra?: { dropShiftIds?: string[]; add?: NewShift[] }): Promise<RuleViolation[]>
```
Routes: `GET /v1/roster/rules` (read: anyone with roster read), `PUT /v1/roster/rules` (admin/owner; `{ severity: Record<RuleId, "block"|"warn">, avgWeekReferenceWeeks }`, audit `roster.rules_changed`), `POST /v1/roster/weeks/{id}/check` (dry run, returns violations on that week's shifts). `loadRuleContext` reads **all** locations (hidden sites must still produce double-booking and rest violations) and sets `visibleLocationIds` from the caller's scope so the domain masks them; public holidays come from `public_holidays`; `left` from `deactivated_at`; `expired_licence` from `member_qualifications` against `shift_types.requires`; leave approved only; availability windows.

- [ ] **Step 1: Write the failing tests:**
  - `AC-RS-04: a shift leaving 10 h rest produces a daily_rest warning naming the person and both shifts`
  - `double_booking and approved_leave are block by default, the rest warn; severities come from the tenant setting (changing it changes the result)`
  - `Review Focus 3: night shift 22:00-06:00 on 24 Oct 2026 is 9 real hours; rest after it is counted in real time; 48 h average uses the configured window`
  - `Review Focus 1: a supervisor's check of a shift that clashes with a hidden site's shift returns "Already rostered elsewhere" with no site name, time or shift id; JSON.stringify has none of them`
  - `avg_48h text for a caller who does not see every location carries no hour total`
  - `a deactivated member's shift gets the left violation; expired licence on a required type gets expired_licence`
  - `check for a week of another location is 404; dry run writes nothing (no history, no audit, no event)`
  - `PUT /v1/roster/rules: supervisor 403; unknown rule id 422; avgWeekReferenceWeeks outside 1..52 is 422`
  - `context loader is bounded: a 4-week window with 1 000 shifts runs 6 queries or fewer (query counter)`
  - isolation fixture for `/v1/roster/weeks/{id}/check`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): roster rule engine on the server with tenant severities and masked hidden-site clashes`

### Task 9: Draft weeks and shifts: create, add, move, remove (FR-RS-10, 20, 21, 22 assign several)

**Files:** `api/src/modules/rosters/weeks.ts`, `shifts.ts`, `dto.ts`, routes; test `weeks.test.ts`, `shifts.test.ts`.

**Interfaces:** `POST /v1/roster/weeks` (`{ locationId, weekStart }`, Monday only, 409 `week_exists` returns the existing id), `GET /v1/roster/weeks?locationId=&from=&to=&view=` (payload: weeks, shifts, shift types, targets, day columns computed with domain `dayColumns`, members cut by scope, `view` of day/week/fortnight/month via `rosterRange`), `GET /v1/roster/weeks/{id}`, `POST /v1/roster/weeks/{id}/shifts` (`{ shifts: [{ date, userIds: (string|null)[], shiftTypeId, role?, start?, end?, unpaidBreakMin? }] }` assigns several people at once; start and end default from the shift type and may differ per person, FR-RS-20), `PATCH /v1/roster/shifts/{id}` (`{ version, patch, reason? }`, whitelist `date, start, end, unpaidBreakMin, userId, shiftTypeId, role`; a move to another week is refused), `DELETE /v1/roster/shifts/{id}`. Eligibility (`left`, missing or expired required qualification) is always 422 `ineligible`; a block violation caused by the change is 422 `rule_blocked` unless office with reason; warnings return in the body (`violations`) and never stop a draft edit. Events none for drafts (history only: `roster_history` action `shift_added|shift_moved|shift_removed`). Computes `start_at`/`end_at` with `wallToEpoch` in the location zone (R8-2).

- [ ] **Step 1: Write the failing tests:**
  - `AC-RS-01: GET week for a location returns 7 day columns with each person's own start and end and count against target; short and over computed`
  - `AC-RS-02: two people on one shift with different start times both persist and read back`
  - `FR-RS-21: a 22:00-06:00 shift stays on its start date and its end_at is the next day; Review Focus 3 clock-change night is 540 minutes`
  - `a start in the 29 Mar 2026 gap is stored as 02:00 local (R8-1), a start in the 25 Oct 2026 fold takes the first occurrence`
  - `assign several people in one request is atomic: if the third is ineligible none is written`
  - `open shift (null user) allowed, does not count towards the day's staff count`
  - `supervisor edits a draft week of a granted location; the same call on another location is 404`
  - `PATCH needs version; stale is 409 version_conflict; two concurrent PATCH on one shift: one wins`
  - `moving a shift to another week is 422 cannot_move_week; changing the person re-runs eligibility`
  - `DELETE of a shift in a draft writes history with the whole shift as before`
  - `GET payload for a supervisor contains no other location (JSON.stringify check), members cut: no home location for a supervisor`
  - `view=month spans the right range; unknown view is 422`
  - `week create for a non-Monday is 422; second create returns 409 week_exists with the id`
  - `source guard: every mutation calls lockRoster before lockActor (spy on call order)`
  - isolation fixtures for `/v1/roster/weeks/{id}`, `/shifts`, `/v1/roster/shifts/{id}`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): roster weeks and shifts with individual times, overnight and DST-correct instants`

### Task 10: Publish, lock, office edit, history, confirm, notifications (FR-RS-23, 24, 35, 37; the core risk)

**Files:** `api/src/modules/rosters/publish.ts`, `history.ts`, `events.ts`; modify `shifts.ts` (lock gate on every write), notification catalogue (read `api/src/modules/notifications/service.ts` for how event ids and preferences are registered; add `roster.published`, `roster.shift_changed`); test `publish.test.ts`, `lock-matrix.test.ts`.

**Interfaces:** `POST /v1/roster/weeks/{id}/publish` (`{ version, reason?, overrideRuleIds? }`) returns `{ week, violations }`; `GET /v1/roster/weeks/{id}/history` and `GET /v1/locations/{id}/history` (cursor `(created_at, id)`, limit 50/100, scope-cut); `POST /v1/roster/shifts/{id}/confirm` (the assigned person only, published weeks only); `weekEditGate` is called by **every** roster write helper, not by routes, so a new route cannot forget it. Publish: warnings never stop; a block needs office plus reason; supervisor over a block is 403 `rule_blocked_office_required`. Office edit after publish: `reason` required, writes history `{before, after, reason}` and audit, clears `confirmed_at` of the affected person, notifies them (R8-17), publishes `roster.shift_changed`. Publishing publishes `roster.week_published` once (payload per R8-14) and notifies every rostered person once.

- [ ] **Step 1: Write the failing tests:**
  - `publish moves the week to published, stamps who and when, writes one history row and one audit row, publishes one roster.week_published event`
  - `AC-RS-05: after publish the supervisor gets 403 roster_locked on add, move, remove, claim approve, swap approve, repeat onto it, template apply onto it; an office roster manager edits with a reason`
  - `lock-matrix: for every mutating roster route in the OpenAPI document that carries a week or shift (enumerated from the live document), a supervisor against a published week is 403 or 409, never 200 (fails when a new route is added without a case)`
  - `office edit without reason is 422 reason_required; with reason the history row has actor, old and new value, reason and the person's confirmation is cleared`
  - `publish with a warn violation succeeds and returns it; with a block violation and no reason is 422; supervisor with a block is 403; office with reason passes and the override is in history and audit`
  - `double click publish: second call is 409 already_published, one notification per person, one event`
  - `concurrent publish and edit: the edit sees published and is gated (no lost update)`
  - `notification: each rostered person gets exactly one published notification; a person on two shifts still gets one; an open shift notifies nobody; quiet hours respected by the existing engine`
  - `confirm: only the assigned user; a supervisor confirming for someone is 403; confirming twice is idempotent; before publish is 409`
  - `history for a supervisor lists only granted locations; GET history of another location is 404; history JSON contains user ids only, no names`
  - `history cursor is stable with equal timestamps (3 rows, same created_at)`
  - `roster history survives deactivation of the person and shows the shift as open after erasure`
  - isolation fixtures for `/publish`, `/history`, `/confirm`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): publish, lock, office edits with reasons, roster history, confirmation and notifications`

### Task 11: Change requests (FR-RS-36)

**Files:** `api/src/modules/rosters/requests.ts`, routes; test `requests.test.ts`.

**Interfaces:** `POST /v1/roster/shifts/{id}/change-requests` (`{ patch, reason }`, supervisor or office on a **published** week; patch whitelist as Task 9 but no `weekId`), `GET /v1/roster/change-requests?status=&locationId=` (scope-cut), `POST /v1/roster/change-requests/{id}/decide` (office; `{ decision, note, overrideReason? }`). Approve applies the patch through the same helper as an office edit (rules re-run; a new block needs `overrideReason`), history and notifications as Task 10, requester notified, affected staff must confirm again. A request cannot move a shift to another week.

- [ ] **Step 1: Write the failing tests:**
  - `supervisor requests a change on a published shift; on a draft week it is 409 use_direct_edit`
  - `office approves: the patch is applied, history has reason and before/after, the person is notified and unconfirmed, the requester is notified`
  - `office rejects: nothing changes, requester notified, note stored`
  - `approve that would add a block violation is 422 rule_blocked without overrideReason; with it passes and records the override`
  - `the patch is re-validated at approval time: if the shift changed since (version), 409 stale_request and the request stays open`
  - `a supervisor decides no request (403); supervisor of another location cannot see or create (404)`
  - `deciding twice is 409; concurrent approve and reject: one wins`
  - `patch with weekId or an unknown key is 422`
  - `list for a supervisor contains only own-location requests`
  - isolation fixtures for `/v1/roster/shifts/{id}/change-requests`, `/v1/roster/change-requests/{id}/decide`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): roster change requests on published shifts`

### Task 12: Open shifts, claims and swaps (FR-RS-38, 42, 43; R8-11)

**Files:** `api/src/modules/rosters/exchange.ts`, routes; test `exchange.test.ts`.

**Interfaces:** `POST /v1/roster/shifts/{id}/claim` (staff, an open shift on a published and upcoming week, eligible), `POST /v1/roster/shifts/{id}/swap` (`{ toUserId, note }`, hand-over to a named colleague), `GET /v1/roster/exchanges?status=&shiftId=`, `POST /v1/roster/exchanges/{id}/recommend` (supervisor on a published week: moves to `recommended`), `/decide` (approver per R8-11), `/cancel` (requester). Approval re-runs the rules; a block stops it unless office with reason. Approved claim assigns the shift, approved swap moves it, both write history, notify and clear confirmation. Staff who see an open shift get a notification when a supervisor posts one (`PATCH` of a shift to `userId: null` or a new open shift on a published week by office).

- [ ] **Step 1: Write the failing tests:**
  - `claim needs eligibility: a person who left, or lacks or has an expired required licence, gets 422 ineligible`
  - `two people claim the same open shift: both requests are stored, approving one makes the other 409 shift_taken on approval`
  - `approver matrix: supervisor approves on a draft week; on a published week only office, unless swap_approval_delegated is true on the location (then the supervisor can); staff never; nobody approves their own`
  - `approval re-runs rules: a block stops it (422), an office reason overrides it and is recorded`
  - `swap to a person at a location the requester cannot see is 404 for the target user's shifts, no leak`
  - `claim on a draft week is 409 (open shifts are claimed once published)`
  - `Review Focus 2 re-assert: a supervisor's decide on a published week without delegation is 403 roster_locked`
  - `cancel by the requester only; deciding a cancelled exchange is 409`
  - `double click claim returns the same exchange (idempotent per shift and user)`
  - `notification to qualified staff on a new open shift lists only people eligible and located (home or rostered) at that site`
  - isolation fixtures for `/v1/roster/shifts/{id}/claim|swap`, `/v1/roster/exchanges/{id}/decide|recommend|cancel`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): open shifts, claims and swaps with delegated approval`

### Task 13: Repeat, week templates and auto-repeat job (FR-RS-22, 26..29; R8-12)

**Files:** `api/src/modules/rosters/repeat.ts`, `jobs.ts`; worker registration (`api/src/worker.ts`); test `repeat.test.ts`, `repeat-job.test.ts`.

**Interfaces:** `POST /v1/roster/weeks/{id}/repeat` (`{ version, weeks: 1..12, replace?: boolean }`) returns `{ created: Week[], conflicts: RepeatConflict[] }` using domain `repeatWeek` inside the transaction; `PUT /v1/roster/weeks/{id}/auto-repeat` (`{ days: number | null }`); `POST /v1/roster/weeks/{id}/save-template` (`{ name }`); `GET /v1/roster/week-templates?locationId=`, `DELETE /v1/roster/week-templates/{id}`, `POST /v1/roster/week-templates/apply` (`{ templateId, locationId, weekStart }`, target must have no roster). Job `roster.auto-repeat` (sweep, tenants with M1A, uses `deps.clock`, ledger `roster_auto_repeat_runs`) creates the next draft `days` ahead and notifies the location's supervisors once.

- [ ] **Step 1: Write the failing tests:**
  - `AC-RS-06: repeat of a published Coppers-style week creates a draft with the same people and times; a person on approved leave that week is an open shift plus a conflict row, not rostered`
  - `Review Focus 5: every copied shift is kept, kept with a warn conflict (open false), or open with a conflict (open true); counts add up: copied = kept + warned + opened`
  - `a repeat that fails midway leaves nothing (all or nothing, N weeks)`
  - `a published target is 409 week_published; a draft target needs replace: true (without it 409 week_exists_draft); a non-Monday is 422`
  - `repeat across the clock change keeps wall start and end of each shift; the 22:00-06:00 shift on 24 to 25 Oct 2026 repeats to the week after with correct instants`
  - `repeat is allowed for a supervisor on their own location's published source (the copy is a draft), refused for a location they cannot see (404)`
  - `public holiday in the target week is an information line only and the person stays`
  - `applying a template at another location turns people from elsewhere into open shifts and matches that site's shift type by name (else shift type null is 422 no_matching_type)`
  - `auto-repeat sweep: due week gets exactly one draft; running the sweep twice, or two workers concurrently, creates one (ledger) and one notification; a week with auto_repeat_days null is skipped; a tenant without M1A is skipped`
  - `the sweep uses deps.clock: frozen clock before the due day creates nothing, on the due day creates one`
  - `delete of a template needs office; supervisor 403`
  - isolation fixtures for `/repeat`, `/auto-repeat`, `/save-template`, `/v1/roster/week-templates/{id}`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): repeat roster, week templates and the auto-repeat job`

### Task 14: My roster, `.ics`, coverage and attention read models, expiry sweep (FR-RS-12, 33, 40)

**Files:** `api/src/modules/rosters/mine.ts`, `read-model.ts`, `jobs.ts` (expiry sweep); `packages/domain/src/ics.ts` (+ web `lib/ics.ts` becomes a re-export, parity test); modify `api/src/modules/read-models/{queries,dto,service}.ts` to add roster items; test `mine.test.ts`, `coverage.test.ts`, `expiry-job.test.ts`.

**Interfaces:** `GET /v1/roster/mine?from=&to=` (own shifts across all locations, published weeks only, one combined roster, FR-RS-33; carries `confirmedAt`, location name and address, no other staff), `GET /v1/roster/mine.ics?from=&to=` (`text/calendar`, `Content-Disposition: attachment`, `nosniff`), `GET /v1/roster/coverage?from=&to=&locationId=` (per location and day: staff, target, short, over, open shifts; scope-cut). Attention feed (`GET /v1/attention`, dashboard, Today) gains items: open shifts in the next 7 days, unconfirmed changed shifts for the person, pending change requests and leave for approvers, expiring qualifications for office, week still draft within `n` days of its start (setting). Job `roster.qualification-expiry` (sweep, ledger `qualification_expiry_notices`) notifies the person and office at the lead days.

- [ ] **Step 1: Write the failing tests:**
  - `staff with shifts at two locations gets one combined list and sees no co-worker names`
  - `draft week shifts never appear in /mine`
  - `ics: CRLF, 75-octet folding, UTC times, VTIMEZONE-free, UID is the shift uuid at the API host, an overnight shift ends next day, the 24 Oct 2026 night is 9 hours`
  - `ics parity: domain buildIcs output equals the old lib/ics.ts output for the existing fixtures (same bytes)`
  - `ics response headers: Content-Type text/calendar; charset=utf-8, Content-Disposition attachment, X-Content-Type-Options nosniff`
  - `coverage for a supervisor lists granted locations only; short and over equal the domain dayColumns; open shifts count as short`
  - `Review Focus 1: attention items for a supervisor name no other location; for an office role with an except list, none of the excepted site`
  - `expiry sweep: a licence expiring in 7 days notifies the person and office once; a second run and a concurrent run send nothing more (ledger); an expired-yesterday licence is reported once`
  - `read-model cache is busted by a roster publish (stamp incremented) so the dashboard shows the new gap within one read`
  - `GET /v1/dashboard still passes its existing tests and its response time budget is unchanged (query count asserted)`
  - isolation fixtures none new (static routes), classification entries added
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): my roster, ics export, coverage and attention items, qualification expiry job`

### Task 15: Carry-ins A: shift-report inbox counts and minutes, Today `hasVoice`, dashboard department filter and grouping

**Files:** `api/src/modules/shift-reports/inbox.ts`, `api/src/modules/read-models/{queries,dto,routes}.ts`, today service in domain/read-models; tests alongside.

**Interfaces:** inbox response gains `counts: { all, open, missing, late, returned, accepted }` (computed in one aggregate query, scope-cut) and per-item `minutesLate` / `minutesOpen` (real minutes by instants, DST-safe); `GET /v1/today` items gain `hasVoice: boolean` (true when the task has an attached voice note the caller can play, N1 nonce path unchanged); `GET /v1/dashboard` and `/dashboard/team-tasks`, `/dashboard/staff` gain `teamId` (uuid; out-of-scope team = empty, not 404, S8 reasoning) and group by **assignee team membership** (not only the filing team) with a documented tie rule (a person in two teams counts once per team, totals count once).

- [ ] **Step 1: Write the failing tests:**
  - `inbox counts equal the number of items of each status under the same filters and scope (property over 3 roles)`
  - `minutes: a report 90 real minutes past due across the 25 Oct 2026 fold is 90, not 30 or 150`
  - `a manager's counts include only their reports' items (no leak of the tenant total)`
  - `today hasVoice true only when a voice note exists and is visible to the caller; false for a task whose voice is out of scope`
  - `dashboard teamId filter returns only that team's tasks and people; a team outside the caller's scope returns empty, same shape, same status as a team with no tasks`
  - `a person in two teams appears under both in the grouped view and once in the totals`
  - `existing dashboard tests unchanged and green`
- [ ] **Step 2 to 4:** run/implement/gates (`api:types`). **Step 5: Commit** `feat(api): inbox status counts and minutes, Today hasVoice, dashboard team filter and assignee-team grouping`

### Task 16: Carry-ins B: calendar team filter, request id in job data, audit indexes

**Files:** `api/src/modules/tasks/views.ts` (calendar), `api/src/core/queue/*` and `api/src/core/events/relay.ts` (job data), `api/src/worker.ts`, `api/src/db/migrations/0046_audit_filter_indexes.sql`; tests alongside.

**Interfaces:** `GET /v1/tasks/calendar` gains `teamId` (same S8 semantics as the list); `enqueue(name, data, opts)` stamps `requestId` (from the request context, or the event id for relay jobs) into the job envelope (not into `data`, so existing job schemas and ledger keys are unchanged); the worker logs with a child logger carrying it; migration adds `(tenant_id, actor_id, seq)` and `(tenant_id, action, seq)` indexes on `audit_events` (plain `CREATE INDEX`, one transaction; no CONCURRENTLY, the runbook states the lock cost at 5 000 rows per tenant).

- [ ] **Step 1: Write the failing tests:**
  - `calendar teamId returns only that team's tasks in the range; out-of-scope team is empty; without teamId the response is byte-identical to before`
  - `a job enqueued inside a request carries that request id in its envelope and the worker log line has it; a relay job carries the event id; ledger and jobId hashes are unchanged (golden jobId test)`
  - `no request id appears in the job data object (data schema validation unchanged)`
  - `EXPLAIN for audit list with actorId filter and with action filter uses the new indexes (plan text contains the index name) on a 5 000-row tenant`
  - `migration 0046 replayed as app_owner leaves the audit chain verification passing`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): calendar team filter, request id in job envelopes, audit filter indexes`

### Task 17: Carry-ins C: platform bell, data-request resolve, per-tenant MRR/health/usage

**Files:** `api/src/modules/platform-console/*`, `gdpr` platform routes, platform schema for `platform_staff.notifications_seen_at` (migration `0047_platform_bell.sql`, platform table, no tenant RLS: follow `platform_staff` conventions); tests alongside; `api/test/platform-isolation.test.ts`.

**Interfaces:** `GET /v1/platform/notifications` (derived feed, no new table: pending data requests, failed payments, trials ending within 7 days, support grants expiring within 24 h; `{ items, unread }`) and `POST /v1/platform/notifications/seen` (stamps the staff member's `notifications_seen_at` from `deps.clock`); `POST /v1/platform/data-requests/{id}/resolve` (`{ outcome: "completed"|"rejected", note }` for a request in `processing`, audit in the platform audit chain, tenant-side status updated through the existing gdpr service, never a tenant-context bypass); `GET /v1/platform/tenants` and `/{tenantId}` gain `mrrCents`, `health` (`green|amber|red` from payment state, last activity, error rate threshold settings, documented rules) and `usage` (`seats`, `activeUsers30d`, `storageBytes`), computed without reading tenant business rows beyond counts (counts through a SECURITY DEFINER view or the existing platform counters; implementer reads `platform-console` for how metrics are done today).

- [ ] **Step 1: Write the failing tests:**
  - `non-staff and a staff member without MFA get 404 on the three routes (C4)`
  - `bell lists the four item kinds, unread counts items newer than notifications_seen_at, seen stamps once and clears unread`
  - `resolve: only from processing; completed and rejected both audit once; second call 409; the tenant's data request shows the new status`
  - `MRR sums active subscriptions in cents per tenant using the plan price and seats; a canceled or unpaid tenant is 0; currency from the plan, never assumed`
  - `health rules table-driven: past_due is red, trial ending is amber, no activity in 30 days is amber, otherwise green`
  - `usage counts are per tenant and a second tenant's rows are not in them (two-tenant fixture)`
  - platform isolation fixtures for the new paths
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): platform bell, data-request resolve and per-tenant MRR, health and usage`

### Task 18: Demo seed for rosters, GDPR coverage, load scenario, API docs

**Files:** `api/src/seed/demo/*` (roster seeding from `public/data/rosters/*.json`, remove `"rosters/*"` from the not-seeded list in `source.ts` and the CLI test expectation), `api/src/modules/gdpr` (export and erasure of roster tables), `load/k6/rosters.js`, `load/thresholds.json`, `.claude/docs/features/rosters.md` (Backend notes B8), `.claude/docs/deploy/demo-seed.md`; tests `seed-rosters.test.ts`, `gdpr-rosters.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `seed: the demo tenant gets locations, supervisors, shift types, targets, a published and a draft week, history, requests, claims, swaps, leave, availability and qualifications; seed ids map to uuids (R8-18); all dates re-anchored by whole weeks (J6) and the wall times kept across DST`
  - `seed invariants: no shift of a supervisor-only location is visible to another supervisor (runs the Task 4 scope over the seeded data), the seeded rule breaks (the overlap and the 1-hour rest) produce their warnings`
  - `seed is idempotent and --reset removes roster rows without orphans`
  - `GDPR export of a person includes their shifts, leave, availability, qualifications and exchanges and no other person's`
  - `GDPR erasure: the person's shifts become open, leave and qualifications are gone, history rows keep ids only`
  - `k6 script lints (node --check) and its thresholds file parses; documented p95 targets: week payload 400 ms, publish 800 ms at 250 users, 40 locations`
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(api): roster demo seed, GDPR coverage, k6 roster scenario and backend notes`

---

## Part B: Front-end switch

### Task 19: Roster client foundation: generated types, adapters, server actions, error mapping

**Files:** Modify `features/rosters/{types.ts,api.ts,index.ts}`; create `features/rosters/adapters.ts`, `app/actions/rosters.ts`; regenerate `lib/api/schema.d.ts` (`npm run api:types`); tests `features/rosters/adapters.test.ts`, `features/rosters/api.test.ts`.

**Read first:** `node_modules/next/dist/docs/` (route handlers, data-security, mutating-data), `.claude/docs/architecture.md`, the B6 plan rulings I10 (mutations), I11 (ids), I12 (time), I14 (scope is the server's), `lib/api/client.ts`.

**Interfaces:** `apiServer()`-based readers `getRosterData(query)`, `getLocationAdminData(id)`, `getMyRoster(range)`, `getLeaveQueue()`, `getExchange(range)`; DTO to domain-type adapters (`toRosterShift`, `toLocation`, ...) so `@opsdesk/domain` pure functions keep working unchanged; server actions wrap every write with `classifyApiError` mapping: `409 version_conflict` (refetch, toast "Changed by someone else"), `403 roster_locked` (read-only state, not an error toast), `422 reason_required` (opens the reason dialog), `422 rule_blocked` (conflicts panel), `402`, `403 module_not_entitled`. No client-side re-scoping of API data (I14); `rosterAccess` is kept only to compute display affordances from the API's `access` object in the payload.

- [ ] **Step 1: Write the failing tests:** `adapters map a week DTO to RosterWeek and RosterShift with wall strings and instants (R8-2) and never invent a location name`, `adapters keep unknown future fields out of components (strict zod parse, a stray field is dropped not thrown)`, `error mapping table: each API code above maps to exactly one UI state`, `getRosterData for a supervisor does not call the rule engine client-side (no import of roster-rules in the web payload path, grep test)`, `server action never forwards a client-supplied X-Tenant (I5)`.
- [ ] **Step 2 to 4:** run/implement/gates incl. `npm run build`, `check:bundle`. **Step 5: Commit** `feat(web): roster API client, adapters and server actions`

### Task 20: Week view and draft editing on the API (FR-RS-10, 11, 12, 20, 21; AC-RS-01, 02)

**Files:** Modify `features/rosters/components/{rosters-view,day-board,person-grid,shift-dialog,templates-panel}.tsx`, `features/rosters/{view.ts,editing.ts}`, `app/(app)/rosters/{page.tsx,loading.tsx}`, `features/rosters/components/skeletons.tsx`; retire `features/rosters/store.ts` use for server data (keep only UI state).

**Behaviour:** `/rosters?location=&week=&view=` renders the API payload; optimistic edits with `version`, server wins on conflict (I10); drag move and add-by-form call the actions; short and over highlights from the payload; violations shown as warnings with the person and shifts named (AC-RS-04 front); controls disabled when the payload `access` says locked (AC-RS-05 front, the API is the authority).

- [ ] **Step 1: Write the failing tests:** `renders 7 day columns with each person's own start and end (AC-RS-01, 02)`, `a conflict (409) shows the server copy and the "Changed by someone else" toast and does not keep the local edit`, `403 roster_locked flips the view to read-only without an error toast`, `skeleton: every block of RostersSkeleton measures within 3 px of the loaded view at 1568 and 390 for owner, supervisor and staff-home shells (TOL as P1)`, `supervisor with one location sees no location switcher options beyond theirs`, `no import from another feature except through its index.ts (lint rule passes)`.
- [ ] **Step 2: Run** `npx vitest run features/rosters`. **Step 3: Implement.** **Step 4:** gates plus `npx playwright test e2e/skeletons.spec.ts` additions arrive in Task 25; a manual light and dark hover/disabled/read-only/open pass at 1568 and 390 is recorded in the commit message. **Step 5: Commit** `feat(web): location roster week view and draft editing on the API`

### Task 21: Publish, lock, history, change requests, open shifts, swaps, repeat panels

**Files:** Modify `features/rosters/components/{publish-dialog,reason-dialog,change-request-dialog,requests-panel,history-panel,conflicts-panel,open-shifts-panel,swap-dialog,repeat-dialog}.tsx`, `features/rosters/{publishing,repeating,exchange}.ts`; skeleton blocks for each panel that has a loading state.

- [ ] **Step 1: Write the failing tests:** `publish dialog lists violations from the API, a block requires a reason only for office, and a supervisor sees the block as not publishable (Review Focus 2 UI)`, `after publish every edit control is disabled for a supervisor and "Request change" is the only action (AC-RS-05)`, `office edit opens the reason dialog and shows the entry in history with reason`, `history panel pages with Load more and shows the empty state's Load older (V1)`, `change request approve with a new block asks for an override reason`, `repeat dialog shows the conflict list with kept, warned and open counts (Review Focus 5)`, `open shifts panel: claim, recommend and approve buttons follow the approver matrix (R8-11)`, `double click guard on publish, approve and repeat (one request each)`, `skeletons measured for each panel`.
- [ ] **Step 2 to 4:** run/implement/gates with the light/dark and hover/disabled state check. **Step 5: Commit** `feat(web): publish, lock, history, change requests, exchanges and repeat on the API`

### Task 22: Locations admin, qualifications, My roster, availability, leave, `.ics`

**Files:** Modify `features/rosters/components/{locations-view,location-form,my-roster,my-calendar,availability-form,leave-form,leave-panel}.tsx`, `app/(app)/rosters/locations/**`, `app/(app)/rosters/mine/**`, `lib/ics.ts` (re-export of domain); a download route handler only if the BFF cannot stream `text/calendar` (check the BFF allow-list; add `Content-Disposition` to the forwarded headers allow-list with a test).

- [ ] **Step 1: Write the failing tests:** `location form saves with version and shows the conflict banner (O1 pattern)`, `supervisor grants multi-select lists only people the caller may see`, `shift types in use show Archive, not Delete`, `qualifications editor shows expiry state (expired, due soon) from the API`, `My roster combines shifts across locations and confirms through the action; confirmed state survives reload`, `availability and leave forms submit and show server errors short`, `leave approval buttons only for approvers; own leave never shows Approve`, `the download button fetches mine.ics through the BFF and the browser receives an attachment`, `skeletons: LocationsSkeleton, LocationFormSkeleton (the [id] loading.tsx is static, no first-location data), MyRosterSkeleton measured`.
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(web): locations admin, qualifications, my roster, availability, leave and calendar export`

### Task 23: Un-hide what the API backs, decouple Staff & Rosters

**Files:** Modify `lib/mock-registry.ts` (remove `/rosters` from `MOCK_ROUTES`, `"roster"` from `MOCK_MODULES`, the roster entries from `MOCK_DATA_READERS` and `MOCK_LOADING_FILES`), `test/mock-isolation.test.ts`, `public/data/shell/navigation.json` (badge stays absent without the flag), `features/staff-rosters/{logic.ts,api.ts}` (stop reading the roster seed: `gapsFromOpenShifts` is fed an empty list; documented in R8-15), `app/(app)/rosters/**/gate.ts` (delete), `scripts/smoke/rosters.json`, `.claude/docs/features/rosters.md`, `.claude/docs/deploy/runbook-go-live.md` (J2 line: rosters no longer in the hidden list), architecture.md "Remaining work".

- [ ] **Step 1: Write the failing tests:** `without ENABLE_MOCK_MODULES the nav shows Location Rosters and My roster for a role with M1A and roster access, and hides them for a Starter tenant (not in plan) and for a platform user`, `with the flag off /rosters renders from the API (no getData reader left under app/(app)/rosters or features/rosters: mock-isolation test)`, `staff-rosters, orders-stock, recruitment, files, payroll-issues, manager-attention stay hidden and their pages and data are untouched (git diff on public/data/staff-rosters is empty)`, `Staff & Rosters page with the flag on still renders its incident and cover model from its own seed (smoke case)`, `search index no longer lists roster items from the mock index; ⌘K roster hits come from /v1/search if the API indexes them, else none`, `public/data/rosters/*.json is read only by the seed script (reader registry)`.
- [ ] **Step 2 to 4:** run/implement/gates, including `npm run smoke`. **Step 5: Commit** `feat(web): show Location Rosters without the mock flag and decouple Staff & Rosters`

### Task 24: Front-end carry-ins: TodayPlayer, inbox counts, deactivate, bell, console columns, calendar and dashboard filters

**Files:** `features/today/**` (TodayPlayer and `lib/task-voice` restored against `hasVoice`), `features/reports/**` inbox header counts and minutes, `features/settings/**` users panel (deactivate control, last-active column: the L3 mock-flag gate is lifted), `components/` platform bell, `features/platform/**` console tenants table (MRR, health, usage columns) and data-requests Resolve, `features/tasks/**` calendar (server `teamId` instead of the client-side department filter), `features/dashboard/**` department filter; each with its skeleton update.

- [ ] **Step 1: Write the failing tests:** `Today shows the audio player only when hasVoice is true and never for a hidden voice`, `inbox status chips show API counts and match the list length under the same filter; minutes late formatted from API minutes`, `users panel: Deactivate asks to confirm, the last owner's control is disabled with the API's 422 mapped, last active shows "Never" for null`, `platform bell shows unread, opens the feed and Mark seen clears it; non-staff never renders it`, `console tenants table shows MRR (formatted with the plan currency), health pill, usage numbers; the skeleton row matches`, `data request Resolve dialog requires an outcome and a note and updates the row`, `calendar team filter sends teamId and the list shrinks server-side (the client department filter code is deleted)`, `dashboard department filter sends teamId and totals reconcile`, `skeletons measured for each touched component`.
- [ ] **Step 2 to 4:** run/implement/gates. **Step 5: Commit** `feat(web): switch the B6/B7 carry-ins (Today voice, inbox counts, deactivate, bell, console columns, filters) to the API`

### Task 25: Playwright and smoke: CR-07, CR-08, CR-09 and skeletons

**Files:** Create `e2e/cr07.spec.ts`, `e2e/cr08.spec.ts`, `e2e/cr09.spec.ts`; modify `e2e/world.ts` (second location, a supervisor, a roster manager, an office user, a staff member), `e2e/skeletons.spec.ts` (roster routes: `/rosters`, `/rosters/locations`, `/rosters/locations/[id]`, `/rosters/mine`, for owner, supervisor, staff-home; reuse `e2e/slow-api.mjs`), `scripts/smoke/rosters.json`, `playwright.config.ts` only if a project needs the new world.

**Read first:** `node_modules/next/dist/docs/` testing/playwright, the existing `e2e/cr01..06.spec.ts` for fixtures and the TOTP sign-in helper.

- [ ] **Step 1: Write the specs:**
  - `CR-07 (AC-RS-01): owner picks a location and week, sees seven days, who is working with times, and the staff count against the target; short days are highlighted`
  - `CR-08 (AC-RS-02): two people on one shift with different start times; both show on the board and in the staff member's My roster`
  - `CR-09 (AC-RS-03): the supervisor sees and edits only their location; another location's URL says no access and its name never appears in the page text or network responses (read the HAR for the other name); an office roster manager sees every location`
  - `AC-RS-04: publishing a week with an under-11-hour rest shows a warning naming the person and both shifts`
  - `AC-RS-05: after the supervisor publishes, every edit control is disabled and a direct API PATCH by their session returns 403; the office manager edits with a reason and the entry appears in history`
  - `AC-RS-06: Repeat roster on the published week creates next week's draft, the person on approved leave is an open shift in the conflict list`
  - `DST day: the 25 Oct 2026 night shift reads 9 hours on the board (world clock fixed by the API test clock, as in B6 walk)`
  - `skeletons: each roster route matches its loaded layout within TOL 3 px (the roster skeleton assertions of Task 20 to 22 in the browser project)`
  - smoke: `/rosters`, `/rosters/mine`, `/rosters/locations` for owner, supervisor, platform (restricted), Starter tenant (not in plan).
- [ ] **Step 2: Run** `npm run test:e2e -- cr07 cr08 cr09 skeletons` against the compose stack (`docker compose -f docker-compose.dev.yml up -d --wait`) expecting PASS on code from Tasks 5 to 24; `npm run smoke` 0 FAIL.
- [ ] **Step 3: Commit** `test(e2e): CR-07..09 roster journeys, roster skeleton project and smoke cases`

### Task 26: B8 gate: isolation, load, docs, follow-ups

**Files:** `api/test/isolation.test.ts` (complete walk with tenant-B ids over every new path), `api/test/route-classification.ts` (verify), `load/k6/rosters.js` run notes in `load/README.md`, `.claude/docs/features/rosters.md` (consolidated Backend notes B8), `.claude/docs/architecture.md`, `.claude/docs/requirements/SRS.md` Appendix A.7 (status: M1A backed by the API except the deferred list), `.claude/docs/deploy/runbook-go-live.md` (roster checks), `.claude/docs/superpowers/plans/2026-11-18-backend-b8-followups.md` (new: rulings made during the build, deferred list, carry to B9/B11, user decisions waiting).

- [ ] **Step 1: Write the failing tests:** `isolation: every roster, leave, location, shift-type, change-request and exchange path answers tenant B's id with 404 and tenant B's row hashes are unchanged after the walk (HASHED_TABLES includes all 14 new tables)`, `route-inventory: 0 unclassified routes`, `Review Focus 1 cross-role matrix over the final routes (4 roles x all GET routes, 2 locations): no other-location string in any body`, `OpenAPI examples present for every new body (existing check)`.
- [ ] **Step 2: Run** the full gates once on the settled tree: `npm -w api test`, `npm -w api run typecheck`, `npx vitest run`, `npm run test:contract`, `npx tsc --noEmit`, `npx eslint .`, `npm run api:types:check`, `npm run build`, `npm run check:bundle`, `npm audit --omit=dev --audit-level=high`, Playwright CR-01..09 + skeletons + smoke, k6 smoke profile with the roster scenario (record p95).
- [ ] **Step 3: Update docs** (above) and write the follow-ups file listing anything not done, with reasons.
- [ ] **Step 4: Commit** `docs(b8): gate evidence, rosters backend notes and B8 follow-ups`

---

## Deferred (B8 does not do these; each is recorded in the follow-ups file)

FR-RS-13 export, FR-RS-14 labour cost, FR-RS-22 rotating pattern, FR-RS-25 roster-to-report prefill (R8-14), FR-RS-45, calendar subscription URL, B9 attendance consumption of `roster.*` events, B11 cover and incident API, webhook delivery replay route (B7 S13), per-location advisory lock (R8-5), a restore drill with roster tables on staging.
