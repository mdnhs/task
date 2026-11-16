# B0+B1 backend: rulings and follow-ups

Collected from the subagent-driven-development ledger on 2026-11-17 (branch feat/backend-b0-b1).

## User decisions
- USER DECISION (2026-11-16): email verification REQUIRED at sign-up (replaces R15).
- USER DECISION (2026-11-16): all auth via Better Auth — T1.1b email verification uses Better Auth's built-in emailVerification (no custom token tables); T1.5 MFA uses Better Auth twoFactor plugin; invites in T1.3 may use our own table but sign-up/sign-in/verify go through Better Auth.
- USER DECISION (2026-11-16): transactional email via Resend (resend.com).
- USER DECISION (2026-11-16): Resend API key + sender managed by the platform super admin from the platform admin panel, not hard env.

## Controller rulings
- Ruling R1: T1.1 tests idle timeout with the default 12 h (no tenant header: advance 12h01m → session_expired; 11h then call then 11h → 200). The per-tenant hours test moves to T1.3 — T1.1 cannot see tenants — cost if wrong: one test relocated.
- Ruling R2: T1.2 builds recordAudit, verifyChain, append-only grants, list route logic WITHOUT HTTP routes; the GET /v1/audit and /v1/audit/export routes + their two tests move to T1.4 (after requirePermission) — avoids a throwaway guard — cost: none.
- Ruling R3: T1.3 creates the roles table (id, tenant_id, key, label, description, home, access jsonb, field_rules jsonb default '{}', is_template, cloned_from) and the real seedRoleTemplates from public/data/shell/roles.json (all ids except "platform"); T1.4 adds clone/patch/field rules/guard — memberships need a role FK — cost: none.
- Ruling R4: "staff" in plan tests means role key "employee" — spec role table calls it Member; roles.json id is employee — cost: none.
- Ruling R5: every /v1 route with a JSON body declares `.openapi({ example })` on its body schema; the walker sends that example. Routes must also resolve path ids (404) — walker therefore validates with a valid body — cost: small per-route example burden, also improves API docs.
- Ruling R6: tenantGetRoutes(app) lives in api/test/harness.ts: GET routes from openapi doc without path params, excluding /v1/me*, /v1/openapi.json — cost: none.
- Ruling R7: tenant currency default 'EUR' comes from the column default / country IE mapping (IE→EUR) in seed data, not from code constants in services — cost: none.
- Ruling R8: RLS policy template is `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` (USING and WITH CHECK) — pooled connections keep '' after a local set_config, bare ::uuid throws — cost if wrong: none, strictly safer. All later tables copy this form.
- Ruling R9: RLS-denial assertions check the pg error on `.cause` (drizzle wraps errors) — cost: none.
- Ruling R10: DB roles created by superuser bootstrap `api/src/db/bootstrap/roles.sql` (also required on dev/prod DB setup); migrations run as app_owner — cost: one manual/infra step per environment, must be in deploy docs (B7).
- Ruling R11 (T0.5): no push — the plan's "push the branch → CI green" verification is a side effect on a shared remote; verify locally instead (run every job's commands locally, validate YAML, build image with docker). User decides when to push. Cost: CI not proven on GitHub until the user pushes.
- Ruling R12 (T0.5): existing .github/workflows/deploy.yml `check` job already covers web (tsc, eslint ., vitest, build) and gates Dokploy deploy — don't duplicate a `web` job; new ci.yml adds api, domain typecheck, security, image. Root `npx eslint .` must pass over api/ and packages/ too. Cost: none.
- Ruling R13: root web Dockerfile copies only root package.json+lock before `npm ci`, but root now declares workspaces (since T0.1) and web imports @opsdesk/domain (since T0.4) → merging this branch likely breaks the Dokploy production build. Real and load-bearing for merge → add controller task T0.6 "web image builds with workspaces" before B1, verified by a real `docker build .`. Cost if wrong: one small task.
- Ruling R14: mfaPassed = twoFactorEnabled is a placeholder — T1.5 MUST replace it with a per-session flag set only after TOTP verification in that session. Carry into T1.5 dispatch. Cost if missed: MFA challenge bypass.
- Ruling R15: email verification at sign-up is a product decision → noted for user; not blocking B1 (invites in T1.3 verify email ownership via token).
- Ruling R16: new task T1.1b "email verification" after T1.1 review closes (keeps T1.1 review scoped): requireEmailVerification on; verification mail via deps.mailer with token link; sign-in before verification → 403 problem+json code email_not_verified; verify endpoint marks verified; resend endpoint rate-limited by Better Auth; token expiry 24h; test factories verify via the captured mail; Google/Microsoft accounts count as verified; T1.3 invite acceptance marks the invited email verified. Cost: ~1 task.
- Ruling R17: /api/auth/* wrapper uses default 12h because no tenant is resolved there; T1.3 must make it use the STRICTEST (minimum) sessionIdleHours across the user's active memberships (fallback 12) so a tenant's shorter limit can't be bypassed via /api/auth/*. Carry into T1.3.
- Ruling R18: T1.1b goes to the T1.1 implementer (resumed) instead of a fresh agent — it already read Better Auth's types; a fresh agent would re-trigger many node_modules permission prompts for the user. Review stays independent. Cost: slight context carry-over.
- Ruling R19: new task T1.1c after T1.1b: `ResendMailer` implementing the existing `Mailer` interface (official `resend` npm SDK), env RESEND_API_KEY + MAIL_FROM (both optional in dev/test; required when NODE_ENV=production — parseEnv enforces), makeDeps picks ResendMailer when key set, else a console/dev mailer (Mailpit SMTP not needed). Unit test with the SDK mocked — no real network calls, no real key in repo. Errors from Resend surface as logged failures without leaking the API key. Cost: one small task.
- Ruling R20 (replaces R19 shape): T1.1c = platform email settings storage + mailer:
- Ruling R21 (plan-mandated formula, controller's call): add tenantId to the hashed payload now (no production data exists; later would need hash versioning) and have verifyChain return { ok: true, head: { seq, hash } } so a future job can anchor heads externally. Folded into T1.2 fix round 1. Cost: tiny now.
- Ruling R22: idle timeout measures the person's inactivity (one lastSeenAt per session); activity on any tenant counts as activity — tenant hours decide how long inactivity is tolerated when that tenant's data is touched. Accepted. Cost if wrong: a tenant wanting "idle on MY data" semantics would need per-tenant lastSeen — not in spec.
- Ruling R23 (SUPERSEDES R22 — R22 was wrong: a 5h-idle person must be expired under a 1h tenant regardless of which tenant they touch first): every authenticated request uses idle hours = strictestIdleHours(user) (min over active memberships, fallback 12), on tenant routes, tenant-less routes and /api/auth/* alike. Cost: none (stricter).
- Ruling R24 (product-ish; surfaced to user, revisable): SRS §2.2 says tenant admin manages users and roles, so escalation is judged on ADMINISTRATIVE modules only — `settings` and `audit` (plus billing when it exists). A non-owner may assign/invite/PATCH-to a role only if that role's access on settings and audit ≤ the actor's; operational modules (tasks, reports, shifts, roster, payroll, …) don't count. The `owner` role is assignable only by owners. Cloning the owner template is forbidden (409 owner_not_clonable) and no role other than key 'owner' may get settings:write AND audit:write beyond the actor's level (covered by the rule). fieldRules edits: only actors with settings:write; not escalation-relevant (they only hide fields). Cost if wrong: admins may grant broad operational access — acceptable per SRS role table.
- Ruling R25: TOCTOU — load and lock the actor's own membership row (FOR SHARE) inside the mutation tx and re-check permission there for role/member mutations. Cost: one extra query.
- Ruling R26: fold the role-PATCH lock-upgrade deadlock (40P01 → 500) into this round: updateRole takes the same per-tenant advisory lock as member changes before lockActor/target FOR UPDATE; use a two-key namespaced advisory lock form pg_advisory_xact_lock(<ns int>, hashtext(tenant)) for the RBAC lock (audit lock keeps its own namespace). Cost: small; avoids a known 500.
- Ruling R27: for a user with twoFactorEnabled, a session with mfa_passed=false may NOT call: /two-factor/disable, /two-factor/generate-backup-codes, /two-factor/enable, /two-factor/get-totp-uri, /change-email, /change-password, /link-social, /unlink-account, /delete-user, /revoke-sessions, /revoke-other-sessions, /update-user → 403 problem+json `mfa_required`. Allowed: verify-totp, verify-backup-code, sign-out, get-session, send-verification-email. Users without 2FA unaffected (first enrolment works). Cost: users on OAuth/stale sessions must step up first.
- Ruling R28 (design for the fix): admin-issued one-time enrolment code (≥ 8 chars from a 32-symbol alphabet or 6+ digits with attempt cap; TTL 15 min; stored sha256) via POST /v1/devices/:id/enrolment-code (settings:write; also the "reset binding" action — clears current binding); bind requires allocated user + valid unused unexpired code + device currently unbound; on success: code consumed, random 32-byte binding secret generated, sha256 stored on device row, cookie carries `deviceId.secret` signed; loadDevice verifies secret hash (timing-safe) — mismatch/reset → unregistered; enrol code attempts capped (5 wrong → code invalidated); audit device.enrolment_issued, device.bound (with UA hash), device.binding_reset. Cookie: per-tenant name `__Host-od-device-<tenantId first 8>` (Secure, Path=/, no Domain) so tenants don't overwrite each other; Secure decided from APP_URL scheme (https → Secure), not NODE_ENV. Document residual risk: a bearer cookie copied off the PC still works until reset. Cost: one round, larger diff.
- Ruling R29: include .dockerignore `**/.env*` + `!**/.env.example` in the fix wave (a developer's api/.env with SECRETS_KEY/BETTER_AUTH_SECRET would be baked into local images) — cheap, security-relevant. Everything else from the final review → FOLLOW-UP list (MFA 401 vs 403 contract unify before web wiring; invite revalidation on accept + revoke route; prod migration entrypoint; unused REDIS_URL; device cookie name 32-bit tenant prefix; Origin check for tenant-less mutations; /list-sessions returns raw tokens).

## Deferred follow-ups (from task and final reviews)
- Task T0.2: minor (deferred): onError does not map Hono HTTPException (malformed body → 500 instead of 4xx) — carry to T1.1 dispatch (first body routes)
- Task T0.2: minor (deferred): incoming x-request-id echoed without length/charset limit
- Task T0.2: minor (deferred): no test for problem+json content-type / x-request-id on AppError and 500 responses
- Task T0.2: minor (deferred): /healthz,/readyz outside /v1 (ops probes, accepted); readyz 503 body not problem+json
- Task T0.2: minor (deferred): server.ts entry guard not symlink-safe (use realpathSync(argv[1]))
- Task T0.2: minor (deferred): server.test.ts asserts only typeof start; process.env restore by copy
- Task T0.3: minor (deferred): bootstrap does not ALTER existing roles to NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB
- Task T0.3: minor (deferred): bypass test checks rolbypassrls only, not rolsuper
- Task T0.3: minor (deferred): RLS guard misses relkind 'p' and does not assert a tenant_isolation policy exists referencing app.tenant_id (USING(true) would pass) — LOAD-BEARING for later tasks; strongly consider fixing in final wave
- Task T0.3: minor (deferred): "not owner" test does not check ownership; assert err.cause.code 42501 instead of regex
- Task T0.3: minor (deferred): closeTestDbs unused, pools never ended
- Task T0.3: minor (deferred): no dev-DB bootstrap script (compose 5433)
- Task T0.4: minor (deferred → carried into T0.5): domain package tests/tsconfig never type-checked (no typecheck script)
- Task T0.4: minor (deferred): no-io regex loose; stale lib/ path comments in moved files
- Task T0.5: minor (deferred): CodeQL may need actions: read on private repo + code scanning enabled; api doesn't declare @opsdesk/domain dep; api image no HEALTHCHECK, ships tests
- Task T0.6: minor (deferred): node:22-alpine npm version unpinned (lockfile made with npm 10, image npm 12)
- Task T1.1: minor (deferred → carried to T1.1b): mfaPassed placeholder fails open — set false until T1.5 (updates R14); add login-CSRF origin test; factories hard-code localhost:3000; no test that 401 leaves lastSeenAt unchanged
- Task T1.1: minor (deferred): rolling refresh cookie dropped by requireSession (rolling effectively absolute)
- Task T1.1: minor (deferred → B7 deploy docs): Better Auth rate limit in-memory per instance, IP from x-forwarded-for (proxy must overwrite)
- Task T1.1: minor (deferred → T1.1b): test "sign-in without a session is untouched" doesn't exercise sign-in/garbage cookie; revoke-other-sessions case doesn't assert row deletion
- Task T1.1: minor (deferred): idle cookie on sign-out gets 401 without clearing cookie; session read twice per /api/auth call
- Task T1.1b: minor (deferred → T1.1c/T1.3): only EMAIL_NOT_VERIFIED mapped to problem+json; other Better Auth errors keep their own JSON shape — build a general mapper (global constraint)
- Task T1.1b: minor (deferred → B7 deploy docs): rate limit prod-only, in-memory, IP header config needed; mail-bomb bounded only by limiter
- Task T1.1b: minor (deferred): social-provider test name overstates; expiry test should assert TOKEN_EXPIRED; testApp({mailer}) returns unused fake mailer (footgun → fix in T1.1c); "24 hours" text hard-coded
- Task T1.1b: minor (deferred → web /verify-email page): verify only after user click, not on page load (mail scanner pre-verification)
- Task T1.1b: minor (deferred): defense-in-depth emailVerified check in authenticateSession
- Task T1.1b: minor (deferred → T1.1c): a real mailer's error message could echo body/token into logs — redact
- Task T1.1c: minor (deferred → final review/B3): no AAD/domain separation per secret purpose, no key-id for rotation
- Task T1.1c: minor (deferred → B7 docs): SECRETS_KEY must come from KMS/secret manager
- Task T1.1c: minor (deferred → B3 BLOCKER): InMemoryAuditSink exported from index.ts; audit not in same tx as settings write
- Task T1.1c: minor (deferred): sanitizer misses name/code fields, URL-encoded token%3D, path tokens; no boot-time warning when prod mail unconfigured; sendTestEmail ok:true under ConsoleMailer; BA 500 mapped to http_error not internal; MAIL_FROM not validated
- Task T1.1c: minor (deferred): mapper should also skip content-encoding/transfer-encoding; upstream x-request-id overwrites ours; no content-length assertion
- Task T1.2: minor (deferred → follow-up task "audit head anchoring" in B7): no HMAC/key, owner can rewrite whole chain; document real control = privileges
- Task T1.2: minor (deferred): app_user can INSERT chosen seq/hash bypassing recordAudit — document "only recordAudit writes audit_events"
- Task T1.2: minor (deferred → small domain fix): csvSafe misses leading \t and \r
- Task T1.2: minor (deferred → T1.4): listAudit default limit 1000 — export must stream/paginate, not truncate
- Task T1.2: minor (deferred): CSV lacks seq/hash (no verifiable export); verifyChain single long tx on huge tenants; cross-tenant write test should assert 42501; no test for hash-field edit
- Task T1.3: minor (deferred → final review, defense-in-depth): own-row policies should add `AND nullif(current_setting('app.tenant_id', true), '') IS NULL`; T1.8 walker must know the two policies
- Task T1.3: minor (deferred → T1.4): concurrent accepts of two invites for same user → 23505 → 500 (map to 409); interim invite permission + no role-escalation rule → replace with requirePermission + "cannot grant a role above your own"
- Task T1.3: minor (deferred): invites to suspended tenant still acceptable; reserved slugs (www, api, admin, app, invite…) not blocked; missing tests for concurrency/inactive tenant; makeMember depends on mailer.last() ordering
- Task T1.3: minor (deferred → T1.4): two stale comments in session.ts/establishSession about tenant hours
- Task T1.4: minor (deferred): clone key race 23505 → 500; R25 test polls unfiltered pg_locks; export mid-stream failure gives truncated 200 (log it); csvSafe tab/CR (already ledgered); suspended-owner edge case; redactFields unused until read routes
- Task T1.4: minor (deferred): invite creation reads target role without lock / without lockRbac (TOCTOU) — take lockRbac first in invite tx; concurrency test is probabilistic (no barrier)
- Task T1.5: minor (deferred → B7/hardening): no per-session TOTP attempt cap / replay protection; rateLimit not configured (prod-only memory store) — add shared-store rate limit + attempt counter
- Task T1.5: minor (deferred): on disable/re-enrol, reset mfa_passed on all the user's sessions; policy role keys vs clone/delete semantics; tenantGetRoutes excludes /v1/me* and non-GET; dead ALLOW entries in mfa.ts; non-string mode → 400 not 422; missing tests (OAuth session false, trust-device, +1 step, stale-session)
- Task T1.5: minor (deferred → final fix wave, load-bearing for R27): add /revoke-session (singular) and /set-password to MFA_PROTECTED_AUTH_PATHS; consider /update-session; tests cover 4 of 12 paths
- Task T1.6: minor (deferred → people/HR feature): /v1/people gated on reports:read via reportScope (hr/payroll/location-supervisor 403); needs own gate (staff/settings) before HR screens use it
- Task T1.6: minor (deferred → final review): people scope derived at runtime from roles.json via cloned_from; fail-open if chain breaks (→ all); persist scope on role row at seed/clone
- Task T1.6: minor (deferred): suspended members keep reporting lines/team membership; manager membership delete cascades reports' lines without audit; coverage gaps (RLS direct test, suspended, chain cap)
- Task T1.7: minor (deferred): no device delete/retire route; listDevices takes FOR SHARE lock on GET; loadDevice conditional UPDATE every 5 min
- Task T1.7: minor (deferred): no https/__Host- round-trip test; no concurrent-bind test; bind UPDATEs lack tenantId in WHERE (RLS covers); small timing diff on live-code wrong attempts
- Task T1.8: minor (deferred → follow-up "body-id walker"): foreign ids in bodies not walked; ghost-code comparison silently skipped; ROUTE_PARAMS malformed → TypeError; route test excludes all ALL methods; X-Tenant=B non-member not walked on every route
- Task T1.8: minor (deferred): walker assumes JSON on 404/ghost responses

## Final review follow-ups (not fixed before merge)
- Unify MFA error contract: tenant routes 401 mfa_challenge/mfa_enrolment_required vs /api/auth/* 403 mfa_required (before web wiring)
- Invites: re-validate role/inviter on accept; add list + revoke routes
- Production migration entrypoint; REDIS_URL required but unused
- Shared rate-limit store + proxy IP header config (before API deploy)
- Device cookie name uses 32-bit tenant prefix; BETTER_AUTH_SECRET rotation breaks device bindings (document)
- /list-sessions returns raw session tokens
- Origin check for tenant-less /v1 mutations before subdomain tenants
- Confirm CI `image` job green on first push (--ignore-scripts verified locally only)
