# Security review checklist and pen-test scope pack (B7 Task 18)

Status key: `[x]` proved by the test or file named on the line, `[ ]` open (an owner and a note follow), `[~]` partly. This page is handed to the external tester (NFR-13: penetration test before first go-live, then yearly). Sign-off at the bottom is done by a person, not by this repo.

Run the proofs: `npm -w api test`, `npx vitest run`, `node scripts/check-secrets.mjs`, `node scripts/audit-gate.mjs`.

## 1. Authentication and session

- [x] Passwords, sessions and cookies are Better Auth's; `useSecureCookies` is on in production and the production boot refuses a non-https `APP_URL`: `api/src/env.ts`, `api/src/env.test.ts` ("production env refuses a non-https APP_URL").
- [x] Auth endpoints are rate limited per client IP, shared across instances in Redis, and fail closed when Redis is down: `api/src/core/middleware/rate-limit.test.ts`, `api/src/modules/auth/rate-limit.test.ts`.
- [x] MFA (TOTP): 5 failed attempts per 15 minutes per user then 429 `mfa_attempts_exceeded`, a used code is refused for 2 minutes, a second tenant needs an MFA-verified session: `api/src/modules/mfa/mfa.test.ts`, `api/src/core/middleware/mfa.ts`.
- [x] Session timeout (NFR-04): 12 hours idle by default, a tenant can set it stricter, a session without a tenant uses the strictest of the user's memberships: `api/src/core/session-policy.ts`, `api/src/modules/auth/auth.test.ts`.
- [x] Device-bound sessions for restricted features (trusted company PC); the device cookie is `__Host-` over https: `api/src/core/middleware/device.ts`, `api/src/modules/devices/devices.test.ts`.
- [x] The platform console requires 2FA before any call: `api/src/core/middleware/platform.ts`, `api/src/modules/platform-console/console.test.ts`.
- [x] State-changing calls must carry the web origin (`Origin` equal to `APP_URL`): `api/src/core/middleware/origin.ts`, `api/src/core/middleware/origin.test.ts`.
- [~] Account lockout after repeated bad passwords is the per-IP limiter only (no per-account lock). Owner: product. Accepted for the first client; revisit with the pen-test result.

## 2. Tenant isolation

- [x] Every tenant table has `FORCE ROW LEVEL SECURITY`; the API connects as `app_user` (no BYPASSRLS), migrations run as `app_owner`: `api/src/db/bootstrap/roles.sql`, `api/test/rls-guard.test.ts`.
- [x] The isolation walker (AC-M0-01): every tenant route, read and write, as another tenant's member, answers 404, never the data: `api/test/isolation.test.ts`, `api/test/route-inventory.test.ts` (a new route without a classification fails the build), `api/test/platform-isolation.test.ts`.
- [x] Cross-tenant ids answer 404, not 403, so existence is not an oracle (global constraint, covered by the walker above).
- [x] The tenant is resolved from the session and membership, never from a client header alone: `api/src/core/middleware/tenant.ts`.
- [x] Support access is an explicit, time-limited, audited grant: `api/src/core/middleware/support.ts`, `api/src/modules/platform-console/console.test.ts`.

## 3. Input and output

- [x] Every route validates its input from the OpenAPI schema (zod); a malformed body is a 400 problem, not a 500: `api/src/app.test.ts` ("malformed JSON body is 400 problem+json"), `api/test/openapi-typed.test.ts`.
- [x] Problem bodies carry no internal text: an unhandled error is a generic 500 with only the request id, no stack, no message, no SQL: `api/src/app.test.ts` ("unknown errors become 500 without stack", "a 500 calls errorReporter.capture ... the response has no error text").
- [x] Uploads are scanned (clamd) before they become downloadable; infected or unscanned files are never served: `api/src/core/scan/clamd-scanner.test.ts`, `api/src/modules/files/files.test.ts`. Production boot refuses a missing `CLAMD_HOST`: `api/src/env.test.ts`.
- [x] Outbound calls to a tenant-supplied URL (webhooks) go through the SSRF guard (private, loopback and link-local ranges refused, DNS pinned): `api/src/core/net/ssrf-guard.test.ts`, `api/src/core/net/pinned-request.ts`.
- [x] Downloads are 302 redirects to a presigned URL that signs `response-content-disposition: attachment` and the stored mime; inline only for png, jpeg, webp, gif and pdf, never svg or html: `api/src/modules/files/files.test.ts`, `api/src/core/storage/s3-storage.test.ts`.
- [x] Every API response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, a locked-down CSP; authenticated JSON is `no-store`: `api/src/core/middleware/secure-headers.ts`, `api/src/app.test.ts`.
- [ ] The bucket domain serves `X-Content-Type-Options: nosniff` through a Cloudflare Transform Rule (a presigned URL cannot carry it). Deploy-time item: `.claude/docs/deploy/dokploy.md` (Edge) and `.claude/docs/deploy/runbook-go-live.md`.

## 4. Edge

- [x] The client address is read in one place and never trusted from the left of `x-forwarded-for`: `api/src/core/net/client-ip.ts`, `api/src/core/net/client-ip.test.ts` (forged, multiple, spaced, IPv6 and empty headers).
- [x] `TRUST_PROXY_HOPS` is the number of proxies that append to the header (Cloudflare plus Traefik is 2); production refuses `0` unless `ALLOW_NO_PROXY=1`: `api/src/env.test.ts`. Check command in `.claude/docs/deploy/dokploy.md`.
- [x] No CORS: the API sends no `Access-Control-*` header; the browser only talks to the web origin, and the web server (BFF) calls the API on the private network: `lib/api/bff.ts`, `.claude/docs/deploy/b6-cutover.md` section 1.
- [x] Metrics (`/metrics`) and `/readyz/details` exist only on the internal port, never behind the public proxy: `api/src/core/observability/observability.test.ts`, `api/src/core/observability/readiness.test.ts`.
- [ ] HSTS and TLS 1.2 minimum (NFR-03) are set at Cloudflare or Traefik, not in the app. Deploy-time check: `.claude/docs/deploy/runbook-go-live.md`.

## 5. Secrets

- [x] Stored secrets (billing, mail and storage settings, integration tokens) are encrypted with AES-256-GCM under `SECRETS_KEY`; a keyring (`SECRETS_KEYS`, `SECRETS_KEY_ID`) allows rotation: `api/src/core/crypto/secret-box.ts`, `api/src/core/crypto/secret-box.test.ts`.
- [x] Key rotation procedure: add the new key to the keyring and make it current, redeploy, re-enter and save each stored secret in the console (there is no automatic re-encryption), remove the old key only when nothing is under it. Written in `.claude/docs/deploy/runbook-go-live.md` (Secrets). The old key must also stay in the separate key backup until then (`.claude/docs/deploy/backup-restore.md`).
- [x] Production boot refuses a weak, short or example `BETTER_AUTH_SECRET`, a missing or low-variety `SECRETS_KEY` or keyring entry (fewer than 12 distinct byte values), the demo seed switches and one database role for both URLs (`DATABASE_OWNER_URL` is optional and is not given to the api or worker): `api/src/env.ts`, `api/src/env.test.ts`.
- [x] Nothing secret in logs or error text: exact deploy-secret values are masked in every logged string, error classes are logged without messages: `api/src/env.secrets.test.ts`, `api/src/core/observability/logger.test.ts`.
- [x] Nothing secret in the browser bundle: `scripts/check-bundle.mjs` (CI `check` job).
- [x] No committed secret: `scripts/check-secrets.mjs` (CI `security` job), `scripts/check-secrets.test.ts`. Finds known token prefixes, private key blocks, a high-entropy or 32+ character hex value on a secret-like name, and `scheme://user:password@host` credentials. **Limits:** it skips `*.test.*`, `*.spec.*`, `*.example`, lockfiles (`package-lock.json`, `*.lock`), binaries, `node_modules`, `.git`, `.next` and lines marked `check-secrets:allow`; a URL password containing a placeholder word (`password`, `secret`, `test`, `e2e`, `example`, `${...}`, `<...>`) or on a local or example host is not flagged; a secret on a name that does not look secret-like, or split across lines, is not found. It is a net, not a proof: rotate anything that was ever committed.
- [x] Platform secrets (Stripe, Resend, R2) live in the platform admin console's encrypted settings, not in committed or compose env: `.claude/docs/deploy/env-matrix.md`.

## 6. Data protection

- [x] EU data residency (NFR-02): `DATA_REGION` accepts only `eu-west-1` and `eu-central-1`: `api/src/env.test.ts`. Managed Postgres and the R2 bucket must be created in the EU (go-live checklist).
- [x] Encryption (NFR-03): TLS at the edge, AES-256 for stored secrets (above); disk and backup encryption is the provider's, confirmed in the go-live checklist.
- [x] Data subject requests: export and erase jobs, audited: `api/src/modules/gdpr/gdpr.test.ts`, `api/src/modules/gdpr/service.ts`.
- [ ] Art. 15 export completeness: the export does not yet include everything the product stores. Known open item. Owner: product and backend, scheduled B8; the DPA text must not promise completeness until then.
- [x] Tamper-evident audit chain, verifiable per tenant, exportable: `api/src/modules/audit/chain.ts`, `api/src/modules/audit/verify.ts`, `api/src/modules/audit/audit.test.ts`.
- [~] Audit head anchoring (an external anchor or HMAC of the head) is deferred (ruling S13). The control today is privileges: the app role has only `SELECT, INSERT` on the audit tables (`api/src/db/migrations/0004_audit_events.sql`, `api/src/db/migrations/0021_platform_staff_audit.sql`), so it cannot update or delete audit rows. Accepted for the first client.
- [x] Backups, restore drill and retention: `.claude/docs/deploy/backup-restore.md`. The first drill must be run and its time recorded before client data (go-live gate).

## 7. Dependencies

- [x] Production dependency tree audit gate (high and critical fail the build, with an expiring allow-list): `scripts/audit-gate.mjs`, `scripts/audit-allow.json`, triage in `.claude/docs/deploy/audit-triage.md`.
- [x] Static analysis (CodeQL) runs in CI: `.github/workflows/ci.yml` (`security` job).
- [ ] Dev-tooling advisories are accepted with a review date in `.claude/docs/deploy/audit-triage.md`; re-triage on the date or on any change to how CI uses those tools.

## 8. Logging

- [x] Structured JSON logs, one access line per request, no query string, header, cookie or body: `.claude/docs/deploy/observability.md`, `api/src/core/observability/logger.test.ts`.
- [x] Redaction by key name at any depth, by token shape, and by exact secret value: `api/src/core/observability/logger.test.ts`, `api/src/env.secrets.test.ts`.
- [x] A failing job logs its class and pg code, never its payload or message: `api/src/core/observability/observability.test.ts` (`logJobFailure`).

## 9. Incident response (NFR-16)

- [ ] Incident contact list filled in (blank below). Owner: operations lead.
- [ ] Breach notification template to customers sent within hours of confirmation so they can meet the 72-hour GDPR clock (the clock starts when the controller, the customer, becomes aware; our promise is to tell them without undue delay and within 24 hours of confirmation). Template to be agreed with the client's DPO.
- [x] Containment levers exist: suspend a tenant, revoke API keys and webhooks, revoke support grants, sign out all sessions, disable a feature flag (`ENABLE_MOCK_MODULES`), roll back (`.claude/docs/deploy/rollback.md`).
- [x] Evidence: the per-tenant audit chain, the platform audit, structured logs with request ids (retention is the log platform's setting; keep at least 12 months for audit, NFR-05).

Incident record template (copy per incident): detected at (UTC), by whom, what, systems and tenants affected, personal data involved yes or no, contained at, customers notified at, regulator notified at (if the controller asks us to help), root cause, fix, follow-ups with owners.

## 10. External penetration test: scope pack

Fill the blanks before sending. Nothing in this pack is a real hostname or credential.

**Target environment.** A throwaway staging environment built from the same images as production (`.claude/docs/deploy/dokploy.md`), its own database, its own Redis and bucket, with the demo seed loaded (`.claude/docs/deploy/demo-seed.md`). Never production, never the first client's data.

| Item | Value |
|---|---|
| Web URL | `https://<staging-web-host>` (to be filled) |
| API URL | the same origin; `/v1/*` and `/webhooks/*` route to the API (BFF in between) |
| Internal metrics port | out of scope and not reachable from outside |
| Test window | to be filled (start and end, UTC) |
| Source IPs of the tester | to be filled (allow-listed at Cloudflare for the window) |
| Environment owner | to be filled |

**Test accounts.** Created by the demo seed on the throwaway environment (three demo tenants), password set by the owner at seed time and sent out of band: an owner, a manager, a supervisor, an employee, a read-only auditor, an HR user, and the platform operator (TOTP enrolled, secret sent out of band). Two tenants are enough to test isolation: the tester needs a user in each and must try to reach tenant A's data with tenant B's session.

**In scope.** The web app and the API behind it: authentication, sessions, MFA, invitations, password reset, tenant isolation and access control (every role against every route), file upload and download, webhooks (SSRF), API keys, billing endpoints (against Stripe test mode only), platform console access control, rate limits, headers and TLS of the staging hosts, business-logic abuse (tenant creation, mail triggers, task and report workflows).

**Out of scope.** Live Stripe, Resend and R2 accounts and their dashboards; Cloudflare, Dokploy and the hosting provider's own infrastructure and control planes; the Google and Microsoft sign-in providers; denial-of-service and load beyond the agreed rate (the load test is ours, in `load/`); social engineering and physical attacks; any other tenant's or client's environment; the Android app (separate scope).

**Rules of engagement (to be agreed and signed).** Test only inside the window and from the listed IPs; stop and tell the contact at once on finding real personal data or a critical issue; no data exfiltration beyond a proof sample; no persistence; clean up created accounts or tell us the list; findings are confidential, reported in 5 working days of the end of the test with severity and reproduction steps; a retest of fixed findings is included.

| Contact | Name | Channel |
|---|---|---|
| Engagement lead (customer side) | | |
| Technical contact | | |
| Emergency stop contact (24 h) | | |
| Tester lead | | |

**Known and accepted, so they are not re-reported as new.** Dev-tooling advisories (`.claude/docs/deploy/audit-triage.md`); no per-account lockout (section 1); audit head anchoring deferred and the Art. 15 export gap (section 6); PDF export is Latin-1 only; mock modules are hidden behind `ENABLE_MOCK_MODULES` and not part of the first deployment.

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering | | | |
| Product owner | | | |
| Security reviewer | | | |
