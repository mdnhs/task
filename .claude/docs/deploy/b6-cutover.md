# B6 cutover: web on the API

What to set, do and check when the web app (B6) goes live for the first client on the real API. The web's own mock is gone for everything the API backs; what is left is isolated behind `ENABLE_MOCK_MODULES` (see `architecture.md` → Data layer).

## 1. Web (Next, Dockerfile at the repo root)

| Variable | Value | Notes |
|---|---|---|
| `API_URL` | the API's internal address, no trailing slash (e.g. `http://api:8080`) | Server only. Never `NEXT_PUBLIC_*`. `scripts/check-bundle.mjs` fails the build gate if it reaches `.next/static`. |
| `APP_ORIGIN` | the public web origin (`https://app.example.com`) | What the browser's `Origin` must equal on a state-changing call. **Must be the same value as the API's `APP_URL`.** Required in production: the server refuses to boot without it and without `API_URL` (`instrumentation.ts`). |
| `ENABLE_MOCK_MODULES` | **unset** on the first client's deployment; `1` on the demo deployment only | Read in one place (`lib/mock-registry.ts`). Unset: rosters, staff rosters, orders and stock, recruitment, payroll issues, files, manager attention, the AI assistant, the seed's nav badges and the console pages with no API route are unavailable and out of the nav. Nothing is deleted (product owner rule: Orders & Stock, client files and the rosters model stay). |

**Client address and rate limits (ruling S3/S4).** The API reads the caller's address in one place (`api/src/core/net/client-ip.ts`) and never trusts the left of `x-forwarded-for`. `TRUST_PROXY_HOPS` is the number of reverse proxies between the internet and the API that append (or set) the caller's address; the client is the entry that many from the **right**. Default `1` in production, `0` in development and test (`0` ignores the header and uses the socket address). The BFF forwards the edge proxy's `x-forwarded-for` unchanged and adds no entry, so with one edge proxy (Traefik on Dokploy) the value is `1`; add one for each further proxy that appends (for example a CDN in front of Traefik: `2`). Check after deploy: sign in from two networks and confirm in the limiter keys (`redis-cli --scan --pattern 'rl:auth-ip:*'`) that each shows its own address, not the proxy's. A value too low rate-limits the proxy's own address (everyone shares one bucket); too high lets a caller choose their bucket. A proxy that does not overwrite or append a trustworthy entry is a defect: fix it at the proxy.

Limits are shared in Redis (`rl:*` keys), so every API instance counts together: auth endpoints per IP (`AUTH_RATE_LIMIT_PER_MIN`, default 30 per minute), mail senders (sign-up, password reset, verification, invites) 5 per hour per target address, TOTP 5 attempts per 15-minute window per user (fixed window; the 6th gets 429 `mfa_attempts_exceeded` until the window ends; a success clears the count; a code already used is refused for 2 minutes). Trade-off: the cap is per user, so someone who knows a user's password can use up the window and keep that user's TOTP refused until it ends (a per-IP cap alone would let a botnet guess the code); support can clear it by deleting the `rl:totp-fail:<userId>` key in Redis, tenant creation 10 per hour per user (and see `TENANT_CREATE_MAX_PER_USER` below). Every refusal is problem+json 429 `rate_limited` with `Retry-After`. If Redis is unreachable, sign-in, sign-up, password reset and TOTP verification answer 503 `rate_limit_unavailable` (fail closed); the other limited calls (invites, tenant creation) go through (fail open).

## 2. API

| Variable | Value |
|---|---|
| `APP_URL` | the **web** origin (same as the web's `APP_ORIGIN`): Better Auth `trustedOrigins`, cookie host, the Google callback |
| `TRUST_PROXY_HOPS`, `AUTH_RATE_LIMIT_PER_MIN` | see the paragraph above; optional, defaults 1 (production) and 30; `AUTH_RATE_LIMIT_PER_MIN` is at most 300 in production (boot refuses more). `api/.env.example` is gitignored, so this table is the tracked list of these two variables |
| `TENANT_CREATE_MAX_PER_USER` | optional, default 5 (1 to 1000). Most tenants one user may create; over it `POST /v1/tenants` answers 403 `tenant_limit_reached`. Counted from `tenants.created_by`, not counting tenants with status `deleted` or `erased`. A user's first tenant needs no MFA; the second and later need an MFA-verified session (401 `mfa_enrolment_required` or `mfa_challenge`). Raise it for an agency that asks support |
| `DATABASE_URL`, `DATABASE_OWNER_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `SECRETS_KEY`, `DATA_REGION` | as in `api/.env.example` (production requires `SECRETS_KEY` and `CLAMD_HOST`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | or the platform admin's stored billing settings. The Stripe **webhook** is `POST /webhooks/billing/stripe` (outside `/v1`, no session, signed). The console shows its URL as `${APP_URL}/webhooks/billing/stripe`, which is the **web** origin: the reverse proxy must route `/webhooks/*` on that origin to the **API host** (the web app has no such route). |
| `RESEND_API_KEY`, `MAIL_FROM` | or the platform admin's stored mail settings |
| `S3_*` | bootstrap fallback only; production uses the R2 settings the platform admin stores |

Run the worker (`npx tsx src/worker.ts`, same image) beside the API: scans, notifications, exports, the 1 s event relay and the recurrence and deadline jobs all live there.

## 3. Bucket CORS (browser uploads)

Evidence, report attachments, voice notes and files are PUT **from the browser** to a presigned URL on the bucket's own origin. The bucket therefore needs a CORS rule:

- `AllowedOrigins`: the web origin (exactly `APP_ORIGIN`)
- `AllowedMethods`: `PUT`, `GET`, `HEAD`
- `AllowedHeaders`: `*` (the presigned headers vary), `ExposeHeaders`: `ETag`

R2: set it in the bucket's CORS policy. MinIO (local, e2e): `MINIO_API_CORS_ALLOW_ORIGIN`. Without it every upload fails in the browser with no server-side trace.

## 4. Database and platform (not web work, carried from B0 to B5)

- Run `api/src/db/bootstrap/roles.sql` once as a superuser, set the two role passwords, then the migrations as `app_owner` (the runbook must include **migration 0020 and the bootstrap roles**).
- `pg_trgm` extension available (search).
- Create the first platform operator with `npm -w api run platform:owner` (2FA is required before any console call).
- R2: lifecycle rule on the `u/` (uploads) prefix; clamd limits (`StreamMaxLength`) at or above `FILE_MAX_BYTES`, and `TASK_VIDEO_MAX_BYTES` if video evidence is on.
- Art. 15 data export completeness is a known open item (B7): it does not yet include everything the product stores.
- The PDF export is Latin-1 only (a Unicode font is a follow-up).

## 5. First client

1. Create the tenant (sign-up and onboarding, or the console) and **set the first client's plan in the console** (Tenants → the tenant → plan; trial dates). The web reads its entitlements from the API on every request, so a module removed from the plan disappears within a minute (AC-M0-05).
2. Invite the people, set roles, teams and reporting lines, report template and device policy (Drive: trusted company PC only).
3. Register the company PCs and issue enrolment codes (Settings → Devices); each member enters theirs under Account → Security.
4. **Do not run the demo seed.** It exists for the demo deployment only (below).

## 6. Demo deployment

Separate environment, separate database from the first client's.

- `ENABLE_MOCK_MODULES=1` on the web.
- Seed: `ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=<12+ characters> npm -w api run seed:demo` (see `demo-seed.md`). The password is set by the owner in Dokploy and never committed. The seed refuses a database with any tenant outside the three demo tenants, but it cannot tell a demo host from a production host by name: keep the environments apart. As a container it is the separate image target `seed` (`docker build --target seed`, see `demo-seed.md`); a build without `--target` is always the API.
- TOTP QR: the second-factor set-up shows the secret and the `otpauth://` link (Decision 1, no QR library). Add `qrcode` (pinned) if the client wants a scannable code.

## 7. Checks before and after

- `npx vitest run`, `npm run test:contract`, `npm -w api test`, `npx tsc --noEmit`, `npx eslint .`, `npm run api:types:check`, `npm run build`, `npm run check:bundle`.
- CI: `contract` (web clients against the real API) and `e2e` (Playwright, CR-01 to CR-06 on the real stack) jobs in `.github/workflows/ci.yml`.
- Locally: `npm run e2e:stack` (Postgres, Redis, MinIO, ClamAV on ports 55432, 56379, 59000, 53310; demo data and fake credentials only), `npm run test:e2e`, and `SMOKE_PASSWORD=... npm run smoke` against a web on a demo database (`SMOKE_MOCK=1` when it runs with `ENABLE_MOCK_MODULES=1`).
- After go-live: sign in as each role once; Settings → Devices shows the registered PCs; a test report submits and reaches the inbox; a proof-required task refuses Complete without evidence.

## Download hardening (B7 Task 4)

- Every API response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, and authenticated JSON carries `Cache-Control: no-store` (`api/src/core/middleware/secure-headers.ts`). No new env.
- File downloads are 302 redirects to a presigned bucket URL. The API signs `response-content-type` (the stored mime) and `response-content-disposition: attachment` for every file; `inline` is only possible for image/png, jpeg, webp, gif and application/pdf, never svg or html.
- A presigned bucket URL cannot carry `nosniff` (S3 and R2 limit). Mandatory at deploy: a Cloudflare Transform Rule (response header modification) on the bucket domain that sets `X-Content-Type-Options: nosniff` (and `Content-Security-Policy: default-src 'none'; sandbox`). The full runbook is Task 19.
