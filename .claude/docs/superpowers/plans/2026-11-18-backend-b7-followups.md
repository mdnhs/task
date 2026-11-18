# B7 (hardening + deploy readiness) — rulings and follow-ups

Merged locally to main at b66a11c (35 commits from 2d9c53c). Tasks 1–17 task-reviewed (fix rounds each); Tasks 18–20 reviewed inside the final whole-branch review (verdict "With fixes", one fix wave AA1, scoped re-review clean). Final gates on the settled tree: root vitest 1724, contract 41, api 1374 (89 files), tsc root+api, lint 0 errors / 27 warnings (baseline), api:types:check current, build + check:bundle clean. A 250-user k6 run passed on localhost (13 min, 0% failures, db_pool_waiting 0), single API process, no BFF/second instance/worker.

## Rulings (binding for later phases)
S1–S15: see the plan (2026-11-18-backend-b7-hardening.md): TRUST_PROXY_HOPS semantics, rate-limit/TOTP buckets (5 attempts per 15-minute fixed window; lockout griefing accepted), tenant cap + MFA (first tenant exempt), 412/428 template ETag, DST gap moves forward / fold takes first occurrence, metrics on a separate internal port, no provider dependency.
T1 migration backfills on FORCE RLS tables run per tenant with set_config and reset app.tenant_id afterwards, and each is tested by running the real SQL as app_owner without tenant context (lesson from 0040/0041). Read-time safety net renders only exact legacy shapes.
U1 support-grant `reason` only for owner|support roles; U2 Revoke visible only for own grant or platform owner (`canRevoke`).
V1 audit "Load older" also in the empty state. W1 board honours `teamId` like the list (filed under OR assignee in team).
X1 /api/session/tenant GET returns a same-origin auto-submit form; the cookie is only ever set to an API-verified membership (nuisance-level switch; cross-site link is NOT blocked).
Y1 access log never buffers; /readyz single-flight 2 s cache, public body ok/not-ok only, details only on the internal port.
Z1 pg.Pool/Redis/BullMQ error listeners (no crash on idle drop). Z2 Redis stamp circuit breaker (100 ms timeout, 5 s open), INCR not awaited on the response path.
AA1 fix wave: hex + URL-credential secret scan, weak SECRETS_KEY refusal, DATABASE_OWNER_URL optional for api/worker (only migrate/seed), log masking of secret values, healthcheck /healthz, de-flaked timing tests.

## Decisions waiting for the USER (before the first client's go-live)
- J2: show the FE-only mock modules (Orders & Stock, client files, rosters, recruitment, payroll, assistant, manager-attention, platform plans/invoices) with ENABLE_MOCK_MODULES=1, or keep them hidden (default). Explicit line in runbook-go-live.md.
- Live Stripe: double-checkout risk, first client's plan set in the console (go-live checklist C).
- Calendar reminder: the accepted picomatch ReDoS advisory (dev tooling, no patched release) expires 2026-12-18; CI goes red on purpose until reviewed.
- Staging must confirm what could not be verified here: Traefik trusted ranges and TRUST_PROXY_HOPS=2 behind Cloudflare, Cloudflare Transform Rule (nosniff + CSP on the bucket domain), Dokploy rollback/domain behaviour, provider WAL/second EU backup copy, a real timed restore drill, the full compose stack (ClamAV amd64), load test with BFF + two API instances + worker.

## Carry to B8+
- restore-drill small gaps; audit selective-filter indexes ((tenant_id, actor_id, seq), (tenant_id, action, seq)); domain `wallToEpoch` (rosters, shift reports, deadlines) still shifts a DST gap by its length (roster-rule decision, S9 applies to tasks only); calendar still filters departments client-side; dashboard read models group by the filing team only; request id not propagated into job data; Better Auth secondary storage (its own limiter stays per-instance); secret with JSON-escaped characters not masked in the final log line; ListQuery/board cursor not bound to its filter (safe); worker heartbeat is timer-based (a stuck job still looks alive).
- B8 API items inherited from B6: inbox status counts and minutes, dashboard department filter, Today `hasVoice`, user deactivate/last-active, platform bell, data-request resolve, per-tenant MRR/health/usage columns.
