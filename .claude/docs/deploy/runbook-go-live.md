# First deploy and go-live runbook (B7 Task 19)

Files and docs only. Nothing here was executed against a live host. Tick each box on the staging run first, then again for production. Companion pages: [dokploy.md](dokploy.md), [env-matrix.md](env-matrix.md), [migrations.md](migrations.md), [backup-restore.md](backup-restore.md), [rollback.md](rollback.md), [security-review.md](security-review.md), [b6-cutover.md](b6-cutover.md), [demo-seed.md](demo-seed.md).

## A. First deploy checklist (staging, then production)

Staging is the same compose file with a **separate database, Redis and bucket**, a staging hostname, Stripe **test** mode and the demo seed.

- [ ] Hosting: Dokploy on a host in the EU; Postgres 16 and the R2 bucket created in the EU (`DATA_REGION` matches); Cloudflare in front of Traefik.
- [ ] Database bootstrap done: `roles.sql` run once as a superuser, two role passwords set, `pg_trgm` available ([migrations.md](migrations.md) bootstrap).
- [ ] `DATABASE_OWNER_URL` is set **only** on the `migrate` job, not on api, worker or web (the API starts without it).
- [ ] **Decide before the first client's deploy (owner: the user):** show the FE-only mock modules (Orders & Stock, client files, the Staff & Rosters incident and cover model, recruitment, payroll, assistant, manager-attention, platform plans/invoices; Location Rosters and My roster are the API's since B8 Task 23 and always shown to roles with M1A and roster access) by setting `ENABLE_MOCK_MODULES=1`, or keep them hidden (default, unset).
- [ ] Environment filled in Dokploy from `deploy/.env.matrix.example`; every value in the secret store, none in Git. The API refuses to boot in production with a weak `BETTER_AUTH_SECRET`, a non-https `APP_URL`, one database role for both URLs, a missing `SECRETS_KEY` or `CLAMD_HOST`, `TRUST_PROXY_HOPS=0` without `ALLOW_NO_PROXY=1`, or the demo seed switches.
- [ ] `TRUST_PROXY_HOPS` equals the number of proxies that append (Cloudflare plus Traefik is 2); Traefik trusts Cloudflare's ranges; the two-network check and the forged-header check pass ([dokploy.md](dokploy.md) Edge).
- [ ] Domains: web host to `web:3000`; `/webhooks` on the same host to `api:8080`; nothing for ports 9464 or 9465; `curl -sI https://<host>/metrics` is not metrics.
- [ ] Cloudflare Transform Rule on the **bucket domain**: `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Bucket CORS set for `APP_ORIGIN` (PUT, GET, HEAD, `*` headers, expose `ETag`). R2 lifecycle on `u/`. R2 **versioning on**.
- [ ] HSTS and minimum TLS 1.2 set at Cloudflare/Traefik.
- [ ] clamd `StreamMaxLength` at or above `FILE_MAX_BYTES` (and `TASK_VIDEO_MAX_BYTES` if video evidence is on).
- [ ] Backups: daily plus WAL PITR on, retention 30 days, encrypted, second EU copy ([backup-restore.md](backup-restore.md)). `SECRETS_KEY`, `SECRETS_KEYS` ids and `BETTER_AUTH_SECRET` backed up separately from the data.
- [ ] `migrate` run with the release image as `app_owner`; last line `migrate: ok`.
- [ ] The deploy gate (container health is only `/healthz`): api `/readyz` ok; `readyz/details` (internal) shows migrations applied equal to expected; worker heartbeat healthy; web `/sign-in` ok.
- [ ] First platform operator created (`npm -w api run platform:owner`) and 2FA enrolled.
- [ ] Console: mail (Resend), storage (R2) and billing (Stripe) settings entered by the platform admin, each with its **test** button. Stripe webhook endpoint added at Stripe pointing at `https://<web-host>/webhooks/billing/stripe`; the signing secret entered in the console.

## B. Staging gate

- [ ] Smoke on the demo-seeded staging: `SMOKE_PASSWORD=... npm run smoke` (set `SMOKE_MOCK=1` while staging runs `ENABLE_MOCK_MODULES=1`) and sign in as each role once.
- [ ] k6 smoke profile against staging (`load/README.md`); the 250-user run meets the thresholds on staging.
- [ ] Isolation gate green on the release commit (`npm -w api test -- isolation route-inventory platform-isolation`).
- [ ] [security-review.md](security-review.md) ticked, open items with owners; the external penetration test (NFR-13) done on the staging environment with the scope pack in section 10 of that page, findings fixed or accepted in writing.
- [ ] **Restore drill done once, time recorded** (`deploy/scripts/restore-drill.sh`, [backup-restore.md](backup-restore.md)): under 4 h, counts and every audit chain pass, one R2 object restored from a version, one stored secret decrypted with the backed-up key.
- [ ] **Rollback rehearsed** on staging: deploy a previous tag, confirm readiness, deploy forward again ([rollback.md](rollback.md)).
- [ ] Browser walks that no automated test covers, on staging: audio player, drag reorder, a DST day, Safari and Firefox evidence, a real phone camera upload.

## C. Before live Stripe keys

- [ ] **Double-checkout risk closed or accepted in writing.** Two concurrent first checkouts can both pass the live-subscription check, and a webhook reporting a `foreign_subscription` is ignored even though the customer is charged. Before live keys: add a conditional claim or an advisory lock on checkout, and an alert on `foreign_subscription` (open item from the B3 follow-ups). Until then keep Stripe in **test** mode, or limit checkout to the platform operator.
- [ ] **The first client's plan is set in the console** (Tenants, the tenant, plan and trial dates). Until then a new tenant is on the starter trial and a blocked tenant answers 402 `billing_required` on writes.
- [ ] Stripe live keys and the live webhook secret entered **in the console** (not in env). Test mode data and live data are separate: re-create the products and prices in live mode and check the price ids map to the plans.
- [ ] One real card payment of the smallest plan by the operator, refunded, end to end, before the client sees billing.

## D. Go-live (first client)

From [b6-cutover.md](b6-cutover.md) section 5, in order:

1. [ ] Production deploy through section A (production environment, **no demo seed, `ENABLE_MOCK_MODULES` unset**).
2. [ ] Create the tenant (sign-up and onboarding, or the console) and **set the plan** in the console.
3. [ ] Invite the people, set roles, teams and reporting lines, the report template and the device policy (Drive: trusted company PC only).
4. [ ] Register the company PCs and issue enrolment codes (Settings, Devices); each member enters theirs under Account, Security.
5. [ ] **Do not run the demo seed.** The API and worker refuse the seed switches in production; the `seed` service must not be started.
6. [ ] After go-live: sign in as each role once; Settings, Devices shows the registered PCs; a test report submits and reaches the inbox; a proof-required task refuses Complete without evidence.
7. [ ] Known open items stated to the client: Art. 15 data export is not yet complete (B8), the PDF export is Latin-1 only, audit head anchoring is deferred.
8. [ ] The roadmap gate: the client signs off CR-01 to CR-06 on staging, the security review passed, the penetration test is closed. Not done by this phase: any live deploy, Stripe live keys, the external test itself, the client's sign-off.

## E. Operations after go-live

- Release: backup, staging, `migrate` with the new image, api and worker, web last ([migrations.md](migrations.md)).
- Weekly: check backups completed, `readyz/details`, queue lag, disk, certificate expiry, `npm audit` gate result ([audit-triage.md](audit-triage.md)).
- Quarterly: restore drill (NFR-07) and re-triage of accepted advisories.
- Yearly: external penetration test (NFR-13).
- Secrets ([env-matrix.md](env-matrix.md)): rotate `SECRETS_KEY` through the keyring when staff with access leave or on suspicion; rotate `BETTER_AUTH_SECRET` in a planned window (it ends every session).
