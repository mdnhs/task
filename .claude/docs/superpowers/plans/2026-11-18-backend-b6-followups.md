# B6 (front-end switch) — rulings and follow-ups

Merged locally to main at 45d5c41 (48+ commits from 7b46282). Every task passed a task review; the final review returned "With fixes"; one fix wave, then a scoped re-review (residual R1 below). Final gates on the settled tree: root vitest 1668, contract 40, api 1163, tsc root+api, lint 0 errors / 27 warnings (baseline), api:types:check current, build and check:bundle clean, Playwright CR-01..06 + smoke + skeleton project run on T6.9 code.

## Rulings (binding for later phases)
J1 TOTP enrolment: secret + otpauth link, no QR. J2 FE-only modules (Orders & Stock, client files, rosters, recruitment, payroll, assistant, manager-attention, platform plans/invoices) hidden behind ENABLE_MOCK_MODULES (default off), never deleted; first-client go-live hides them unless the flag is set. J3 demo deployment / SEED_DEMO_PASSWORD decided at deploy time. J4 first platform owner via `npm -w api run platform:owner`. J5 seed guard runs on the owner connection too, same-database check, re-run under advisory lock. J6 seed dates shift by whole weeks.
K1 every loading.tsx is static (no API/session). K2 requireMfaOk on every API page/action. K3 BFF strips `token` from auth JSON. K4 generic owner/Business skeleton for role-dependent shells (optional later: advisory display-hint cookie). K5 notification read/read-all exempt from 402.
L1 Copy role. L2 logo upload hidden until the API exposes the logo. L3 session timeout read-only; user deactivate control hidden behind the mock flag.
N1 evidence Open via fresh nonce path. N2 task DTO: scoped dependency/blocks with hidden counts. N3 Load more under a narrowing filter (server teamId filter is B7).
O1 409 version_conflict keeps the local text (banner Keep mine / Reload theirs, fetch-failure state). O2 dead mock-only UI hidden without the flag.
P1 constant skeleton drifts fixed exactly (TOL 3px, every block asserted); remaining data/staff/sub-768 drift listed in architecture.md "Remaining work". Q1 one final fix wave (search reset, history dependsOn scope, security headers, dead JSON). Q2/R1 below.

## First items of the B7 plan
1. (R1, before any go-live) Knock-on history text "Moved because TSK-n was rescheduled" (api/src/modules/tasks/planning.ts:239) leaks an out-of-scope root ref number: store the root ref structurally and apply the visibility check at read time.
2. Stale in-flight search load repopulating after reset (global-search.tsx): generation counter.

## Carry to B7 / B8
- B7 API/ops: x-forwarded-for overwrite at the edge (cutover doc), template PUT etag/If-Match, audit API actor/action filters + cursor, POST /v1/tenants per-user cap + MFA, cheap MFA probe endpoint (console probe loads all tenants), staff support-grant list route, presigned Content-Disposition + nosniff, reverse-edge ("Blocks") cap, DST reschedule tweak, seed items (--reset orphans, latest-report-day anchor, lock timeout), GET /api/session/tenant side effect (nuisance), store clearing on session expiry/remote revoke, server teamId filter on GET /v1/tasks, npm audit (35: 15 high, all dev tooling, major downgrades), demo-seed Docker stage, Today-card cookie mirror keyed by tenant/user.
- B8 API: inbox status counts and minutes, dashboard department filter, Today `hasVoice` (TodayPlayer / lib/task-voice kept), user deactivate/last-active, platform bell, data-request resolve, per-tenant MRR/health/usage columns.
- Skeletons: support-role console overview unmeasured; console tenants/audit row count vs seed (+329/-210); staff views typical-owner drift.
- Not browser-walked: Today audio player, export poll on hidden tab, voice record/play, board drag, DST day, Safari/Firefox evidence popup, real phone camera.
- Known: PDF export Latin-1 (Bengali `?`), Art. 15 data export incomplete, CR-02 reset is a fresh code issue, CR-03 Accept has no comment field (documented in Backend notes), double-click guard on Keep mine / Reload theirs, double-checkout risk before live Stripe keys, Next advisory check for next@16.4.2 (the build prints a one-off "upgrade" block that was treated as untrusted).
