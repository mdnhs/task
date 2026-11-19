# B8 (Module 1A rostering on the API) — rulings, deferred work and follow-ups

Branch `feat/backend-b8` (26 tasks: A = 1 to 18 API, B = 19 to 25 web, 26 = this gate). Plan: `2026-11-18-backend-b8-rostering.md` (R8-1..R8-20). Contract: `../../features/rosters.md`. Gate evidence is in section 9. Nothing here was deployed; nothing ran against a real Stripe, Resend, R2 or WhatsApp.

## 1. Rulings made during the build (binding for B9+)

The plan's R8-1..R8-20 stand as written in the plan. These were made later, in review rounds. "Cost if wrong" is what changes if the owner disagrees.

| ID | Decision | Why | Cost if wrong |
|---|---|---|---|
| R8-A | Small review fixes of Tasks 1+2 ride along with Tasks 3+4 (0044: `lower(name)` unique index on shift types, `member_qualifications(tenant_id, file_id)` index) | cheap while 0044 was unreleased | the 0044 index swap fails on a database with case-variant duplicate names (migrations.md note) |
| AB1 | `roster_change_requests.shift_version`; week/shift location consistency by composite FK; `lock_timeout` 5 s on roster locks (409 retry); lock marker instead of a `pg_locks` scan | stale_request needs the base version; a hang is worse than a retry | none |
| AC1..AC4 | Roster level can never be granted, cloned or assigned above the caller's own (403 `role_escalation`), also by `PATCH access.roster` and `changeMemberRole`; `last_owner` is 409 everywhere; `lastActiveAt` only with settings read; in-process dedupe of the last-active stamp | privilege escalation path in the role editor; consistency | a custom role editor must send `rosterLevel` explicitly |
| AD1..AD5 | A read-only API key cannot write "self" data (leave, availability); leave list newest first with keyset cursor; started leave cannot be cancelled (422 `leave_started`); hidden-site violations collapse to ONE generic "Already rostered elsewhere"; `PUT /v1/roster/rules` uses ETag/If-Match and is PATCH-like; `ignore` is not allowed on the statutory rules | key principals; hidden-site side channels; lost updates; legal minimums | an owner cannot silence the 11 h or 48 h rules |
| AE1..AE6 | Only ACTIVE members are notified; cross-site loan answers are opaque ("Member", generic `ineligible`); a published-week edit that causes a new block needs `overrideRuleIds` as well as a reason; history overrides are masked on read; notifications are batched (O(1) lookups per publish) | a deactivated person got "Roster published"; a supervisor could probe people of a hidden site | none |
| AF1..AF6 | Staff see a DRAFT week's shift as 404 for claim and swap and hear nothing from draft changes; the swap colleague may decline; max 5 open exchanges per requester and a 1 h cooldown per shift and colleague; open-shift audience filtered in SQL before the 500 cap; approving a claim rejects the other open claims; one open change request per shift | R8-17 (a draft tells nobody); spam loop; qualified people past the cutoff | the approver, not the colleague, decides by default (see section 5, question 1) |
| AG1..AG4 | `replace: true` on repeat REQUIRES `targetVersions` for every target Monday; inbox counts only on the first page; worker wraps jobs in the job's request id; GDPR job data uses `dsrId` | a stale draft could be silently deleted; 11 queries per page | the web must always send `targetVersions` (it does) |
| AH1..AH3 | GDPR erase takes the roster lock in the deactivation order (RBAC, shifts, ROSTER, DSR, membership); the platform bell lists data requests that staff can act on (`running` and `failed`); `markBellSeen` is one `GREATEST` update; health: trial past its end is amber, suspended red | a 40P01 deadlock between erase and a publish; stuck requests could not be resolved | none |
| AI1..AI3 | Week and `/mine` payloads carry `access { level, canEdit, locked, lockReason }` computed by the gate itself; web error states are distinct (conflict, locked, reason_required, rule_blocked + needsOffice, billing, mfa, rate limit, network) | the web must not re-derive authority; every answer has one UI | none |
| AJ1, AK1, AL1, AM1, AN1 | Review carry-ins were folded into the next task (same feature, same files) instead of separate rounds; jsdom devDependency pinned to 27.4.0 | fewer rounds | a carry-in missed by the next reviewer: each was named in the next brief |
| AO1 | Pre-existing e2e failures at the Task 25 base were fixed before the gate: DashboardBody React key warning (real bug), CR-06 spec premise (Leo has two running shifts), shifts week@390 filter bar, audit skeleton; ceilings re-set with reasons | the gate cannot be green on red specs | none |
| Task 26 | The tenant audit log is NOT cut by roster scope (finding of the cross-role matrix, F-A1 below) | `audit:read` is a tenant-wide permission; cutting rows by site needs an entity-to-location join on every row | an office manager with `except` reads the whole tenant audit trail (and can export it) until F-A1 |

## 2. Deferred in B8 (not built; each is a follow-up phase)

| Item | Why it is not in B8 | Where it goes |
|---|---|---|
| FR-RS-13 PDF/Excel export | needs the export job and layout design; the B5 exporter is report-specific | a later M1A pass |
| FR-RS-14 labour cost | needs pay rates, which belong to Module 1C payroll | M1C |
| FR-RS-22 rotating pattern | a second recurrence model beside repeat/auto-repeat; the first client works with repeat | a later M1A pass |
| FR-RS-25 roster-to-report prefill | R8-14: reports FK a `shift_patterns` row; a roster shift has none. Needs a B5 schema decision with B9's attendance | B9 (event `roster.week_published` already carries `{weekId, locationId, weekStart, shiftIds}`) |
| FR-RS-45 suggestions | Module 2 | M2 |
| Calendar subscription URL | the `.ics` is an authenticated download (no guessable or leakable secret URL); a subscription needs revocable tokens | later, with a token table and revoke UI |
| B9 attendance consumption of `roster.*` events | B9 not built; nothing consumes the 12 events | B9 |
| B11 cover and incident API | Staff & Rosters stays FE-only and hidden behind `ENABLE_MOCK_MODULES` (R8-15); it shows no "From roster" gaps until B11 | B11 |
| Webhook delivery replay route (B7 S13) | out of scope of M1A | a platform pass |
| Per-location advisory lock (R8-5) | cross-site rules need one consistent read; one writer per tenant | revisit above ~20 concurrent roster editors in one tenant |
| Restore drill with roster tables | needs the staging host | runbook B (new checkbox) |

## 3. Open follow-ups (collected from every review round)

API and behaviour:
- **F-A1 Audit scope (OWNER DECISION NEEDED before the first client with a cut office manager).** The Roster Manager template carries `audit:read`, which is tenant-wide: an office manager cut from a site by an `except` list reads the WHOLE tenant audit trail through `GET /v1/audit` (all sites' roster lines with names, reasons and ids, plus the role, member and task audit) and can export it as CSV through `GET /v1/audit/export`. It is not only the excepted site's lines. Nothing is deployed yet and no client has a cut office manager, so nobody is exposed today. Recommended fix (a): set `audit: none` on the roster-manager role template and add a per-tenant migration that sets it on existing roster-manager roles (set_config per tenant, reset after the loop), then flip the pinned assertion in `api/test/roster-cross-role.test.ts` (the cut office manager gets 403 on `/v1/audit` and `/v1/audit/export`). Alternative (b), 403 on `/v1/audit*` for `rosterLevel: office` when cut, keeps the permission for the uncut. Supervisors and staff are already 403. Found by the cross-role matrix (Task 26) and widened by the final review. NOT changed in code on purpose (ruling AP1).
- **F-A2** An exchange stores no shift version or time snapshot: approving after the shift was retimed uses the live shift. Add `shift_version` to `roster_exchanges` (stale_request like change requests).
- **F-A3** Notification kind `member` is reused for roster notices (a dedicated `roster` kind needs a preferences migration and the settings screen).
- **F-A4** The default `location-supervisor` role has `attention: none` (task attention items are tenant-wide for that scope, so granting it would show other sites' task titles). Supervisors therefore never see roster attention items. Needs team/site-scoped task attention first.
- **F-A5** Staff have no read endpoint for open shifts or colleagues, so My roster shows no claimable shifts and offers Swap only to callers with a people list. Needs a staff-safe read.
- **F-A6** Fortnight and month views: Publish and Repeat act on the first draft week of the range (labelled with its date); a multi-week action is not offered.
- **F-A7** The week payload's member pick list is capped at 500 (`membersTruncated`); the UI shows "List is cut at 500" but has no search.
- **F-A8** Claim button is shown to office users who are not located at the site (the API answers 404; accepted: the API decides).
- **F-A9** Losing claims stay `requested` until rejected (approving one auto-rejects the others since AF4; claims that arrive after stay open); no sweep job closes expired exchanges.
- **F-A10** `minorMoney` in the console divides by 100 (wrong for a zero-decimal currency such as JPY; EUR and GBP are right).
- **F-A11** Pseudonymous ids remain after erasure (`roster_weeks.published_by`, `leave_requests.decided_by`, exchange `decided_by`, ids inside other people's change-request patch JSON): documented, ids only.
- **F-A12** The auto-repeat back-off clears only for a hand-made week the sweep would have drafted itself; very long outages need an operator look at `locations.auto_repeat_failures`.
- **F-A13** Platform bell `healthOf` thresholds are documented defaults, not tenant settings; the bell is O(tenants x 3 queries) per poll (fine at pilot size).
- **F-A14** Open shifts duplicate when a client resubmits (an identical assigned shift is `shift_exists`; open shifts may repeat by design).
- **F-A15** `.ics` edge cases: the download is rate limited to 20/min per person; filename decoding falls back to `roster.ics`; the file has no VTIMEZONE (UTC times only, by design).
- **F-A16** Real Redis cache stamp and the live BullMQ scheduler (15 min and hourly cron cadence) were not observed under real conditions; the e2e stack runs the worker against real Redis but a scheduler tick was not asserted. Staging item (section 6).
- **F-A17** Test debt: some UI flows are jsdom-only (shift type save/archive, supervisor save, swap dialog, keyboard-only moves, drag after add, the `reason_required` hover/disabled states in dark).
- **F-A18 (M-4)** `POST /v1/platform/data-requests/{id}/resolve` is allowed for platform owner AND support staff. Resolving as `completed` asserts that an erasure or export really happened, so consider owner only (support keeps `rejected`).
- **F-A19 (M-7)** Every successful non-GET call busts the whole tenant read-model cache, including the pure-read `POST /v1/roster/weeks/{id}/check`. Fine at pilot size; skip the bust for that route (a `readOnlyPost` flag) when the cache hit rate matters.
- **F-A20 (R-minors 8 to 10, left as is)** Leave matching uses the START date of a shift only (an overnight shift that runs into a leave day is not flagged); the qualification-expiry job reads dates in the tenant zone, not the person's site zone; qualification type matching is by lowercase text (no controlled list); the auto-repeat candidate ledger can list a source week that was meanwhile unpublished (re-read under the lock, so harmless).
- **F-A21** Cross-image roll: after an api rollout the worker must roll at once (DSR job key `requestId` renamed `dsrId`); see migrations.md and rollback.md. A worker rolled back to a pre-B8 image needs the roster job schedulers removed.

Web:
- **F-W1** History panel shows a new entry only after reload (an edit re-reads the week, not the panels) and does not show the office's override reason on an approve over a block (it is in the API history's `after`).
- **F-W2** An office edit on a published week that also hits a blocking rule asks for the reason twice (reason dialog, then the rule dialog).
- **F-W3** "Today" is org-based and in partial weeks (fortnight/month) hides "Start week".
- **F-W4** `app/(app)/rosters/page.tsx` still has its own `can()` gate beside the API's access object (harmless, pre-existing).
- **F-W5** Inbox "Submitted" chip has no number (the header shows "N open").
- **F-W6** TypeCard "Try again" after a 409 may spin (the refreshed copy arrives after the click).
- **F-W7** I3 card order: a new shift type created whose targets were refused jumps to the start of the grid.
- **F-W8** (resolved: nothing to fix) The `POST /rosters/mine` seen on load is the global search warming its index: `features/search/components/global-search.tsx` calls the `searchIndex` server action (`features/search/actions.ts`) 1.2 s after any page is idle, and a server action posts to the current URL. It only READS (session plus the role-filtered static search index) and writes nothing; it is on every page, not specific to My roster. Not an RSC prefetch (those are GETs).
- **F-W9** My roster's DST "9h" check only runs while the night is inside the four-weeks-back window (until 21 Nov 2026).
- **F-W10** Location history is loaded by the admin page but not shown.
- **F-W11** The dashboard team filter shows an error card when the team call fails (by design); a revert needs a shell setter.
- **F-W12** Hover text colour persists on the active (pressed) filter segment while the pointer is over it (pre-existing).
- **F-W13** The roster week skeleton is exact for the office view only; supervisor (+633/+638/+474 px at 1568/768/390), staff "Access restricted" (+1714/+1964/+3492), weeks with requests or open shifts (LEAD check: head and board exact, panels follow the data), the locations list and the Coppers form are measured CEILINGs in `e2e/skeletons.spec.ts`. Other ceilings: shifts week@390 505 (chips are data), console tenants@390 2760 (row count), console audit 16300/25300 (the page's 200-row cap; the e2e platform audit grows by a row per run), audit@768/390 (uuid wraps), data-requests (no actions column in the typical list), console tenants support role (no MRR column). Staff and supervisor skeletons need a role hint cookie (K4).

## 4. Carry to B9 and B11

- B9: consume `roster.week_published`, `roster.shift_changed`, `roster.exchange_decided`, `roster.leave_decided`; decide how a rostered occurrence feeds attendance and the shift report (FR-RS-25, R8-14); FR-RS-39 attendance rights for a site supervisor.
- B11: cover and incident API (replaces the "From roster" gaps with the API's open shifts); a document link for `member_qualifications.file_id` (the column exists, proof files expire on erasure).
- Every new FK on a big table: `NOT VALID` then `VALIDATE CONSTRAINT` (migrations.md).
- Any new roster route: classify it in `api/test/route-classification.ts`, add `SPECS` and fixtures to the isolation walk; the matrix in `api/test/roster-cross-role.test.ts` picks every GET up from the OpenAPI document by itself.

## 5. Decisions waiting for the owner

1. **Swap acceptance.** Must the colleague ACCEPT a swap before the approver decides? Built: the approver decides and the colleague may only decline (AF2). Say if acceptance must be added.
2. **`ENABLE_MOCK_MODULES` at go-live.** Show the FE-only mock modules (Orders & Stock, client files, the Staff & Rosters incident and cover model, recruitment, payroll, assistant, manager attention, platform plans/invoices) or keep them hidden (default). Location Rosters and My roster are real and always shown to roles with M1A and roster access.
3. **Live Stripe double-checkout risk** (checklist C of the go-live runbook): two concurrent first checkouts can both pass the live-subscription check. Close it (conditional claim or advisory lock plus an alert on `foreign_subscription`) or accept it in writing; keep Stripe in test mode until then.
4. **WhatsApp** (plan `2026-11-18-whatsapp-integration.md`, built after B8 to B11): open decisions W-x with default recommendations, and the consent text needs legal approval.
5. **Light-brand contrast limit.** Light brand colours (yellow, white, cyan) give outline and focus fills under 3:1 against the surface (documented limit); text tokens are all at least 4.5:1.
6. **picomatch advisory.** Removed from the allowlist on 20 Nov 2026: `npm audit` no longer reports it. If it returns, CI goes red on purpose until triaged (audit-triage.md).
7. **Audit scope (F-A1).** Decide before the first client with a cut office manager. The cut office manager reads the whole tenant audit trail and can export it. Recommended: `audit: none` on the roster-manager template plus a per-tenant migration.
8. **Resend domain verification** is done manually by the owner in the Resend dashboard (the in-app domain feature was dropped on 19 Nov 2026).
9. **Staging verification list** (what could not be verified here, runbook B): Traefik trusted ranges and `TRUST_PROXY_HOPS=2` behind Cloudflare; the Cloudflare Transform Rule on the bucket domain; Dokploy rollback and domain behaviour; provider WAL and second EU backup copy; a timed restore drill WITH the roster tables; the full compose stack (ClamAV amd64); the load test with the BFF, two API instances and the worker (the 250-user roster profile); the roster worker cadence and real Redis stamps; a real calendar app reading the `.ics`; Safari and Firefox; a real phone.

## 6. Verification limits of this branch

Real-browser checks covered the office, supervisor and staff paths named in the Task 20 to 25 reports; dark mode, 768 and hover/disabled states were sampled, not exhaustive. Several flows are jsdom-tested only (F-A17). No live provider, no deploy, no staging host.

## 7. Migrations 0043 to 0049

See `.claude/docs/deploy/migrations.md`. 16 new tenant tables, all FORCE RLS, all in `api/test/isolation-tables.ts` (the new test derives the list from the SQL files).

## 8. Isolation evidence (Task 26)

- `api/test/isolation.test.ts`: every B8 path with a record id is a SPEC (walk with tenant B's ids: 404 with the resource-specific code, same code as a never-existing id, problem+json, no B value in the body, B's row hashes unchanged); control run with A's own ids is not 404.
- `api/test/route-inventory.test.ts`: 0 unclassified routes.
- `api/test/roster-cross-role.test.ts` (new): 6 callers (supervisor, cut office manager, staff, platform staff without a grant; the supervisor and staff of the other site as the mirror) x every GET route in the OpenAPI document with the other site's ids and filters: no other-site string in any body or header; mutation-checked by removing the scope cut of the week list (the matrix fails by name). A migrations-derived test requires every table created by 0043 to 0049 in `HASHED_TABLES`, every B8 route classified, and an example on every B8 request body.
- A dropped tenant filter alone does not leak (RLS is the second wall); the walk's own mutation check therefore uses the scope cut.

## 9. Gate evidence (settled tree, 20 Nov 2026)

| Gate | Result |
|---|---|
| `npm -w api test` | 123 files, 1809 passed |
| `npm -w api run typecheck`, `npx tsc --noEmit` | clean |
| root `npx vitest run` | 174 files, 1876 passed |
| `npm run test:contract` | 8 files, 41 passed |
| `npx eslint .` | 0 errors, 27 warnings (baseline) |
| `npm run api:types:check` | current |
| `npm run build`, `npm run check:bundle` | ok, clean (5 patterns) |
| `npm run check:audit` | pass (the stale picomatch allowlist entry was removed in the final fix wave) |
| Playwright desktop + android | 27 passed |
| Playwright skeletons | 69 passed |
| `npm run smoke` (fresh demo seed, flag off) | 75/75. On a database that already holds the Playwright roster world it is 70 to 73 of 75 (the shifts "19 people" text and Grace's "Access restricted" assume the plain seed; a platform TOTP code cannot be reused inside its 30 s window) |
| k6 smoke with the roster scenario | `roster_week` p95 79.0 ms (target 400), read 99.2 ms, write 43.9 ms, report submit 30.1 ms; no `roster_publish` or `roster_mine` samples; all thresholds passed on a fresh database (details in `load/README.md`) |

Isolation: see section 8. The stack ran under its own compose project and ports (web 3470, API 3471, proxy 3472, PG 55472, Redis 56472, MinIO 59072, ClamAV 53372) and was removed afterwards.
