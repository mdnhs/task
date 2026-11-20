# Environment variable matrix (B7 Task 19)

Every variable the API, the worker, the web and the deploy scripts read. `deploy/.env.matrix.example` lists the names the compose file interpolates (names only, empty or `CHANGE_ME`). `api/test/deploy-files.test.ts` fails if a variable in `api/src/env.ts`, the web's `process.env.*` or a script is missing here.

Legend: **Req** = required in production (`yes`, `no`, or `console` = normally set in the platform admin console, env is only a bootstrap fallback). **Secret** = goes only into Dokploy's secret store and never into the repo, a log or a client bundle. **Who** = who sets it: *ops* (the deployer, in Dokploy), *console* (the platform admin, stored encrypted in the database), *compose* (fixed in `deploy/docker-compose.prod.yml`), *Next* (the framework). Production boot refuses the values marked **refused**: `api/src/env.ts` (tests in `api/src/env.test.ts`). An empty value counts as unset.

## API and worker (same image, same env; the worker reads the same set)

| Variable | Req | Default | Production rule | Secret | Who | Rotation |
|---|---|---|---|---|---|---|
| `NODE_ENV` | yes | `development` | must be `production` (`development` and `test` turn the production refusals off) | no | compose | n/a |
| `PORT` | no | 8787 | the image sets 8080; 1 to 65535; must differ from `METRICS_PORT` | no | compose | n/a |
| `DATABASE_URL` | yes | none | the `app_user` role (no BYPASSRLS, not the owner). **Refused** if its user equals the owner URL's user | yes | ops | change the role password in Postgres, update here, restart api and worker |
| `DATABASE_OWNER_URL` | **no** (api and worker); yes for `migrate` | none | the `app_owner` role. **Not given to the api, worker or web containers**: the runtime never uses it, so it is optional in `api/src/env.ts` (validated, and refused if it uses the same role as `DATABASE_URL`, only when present). Only the one-shot `migrate` service (and the demo `seed`) get it; `api/scripts/migrate.ts` refuses to run without it | yes | ops | same as above, then re-run `migrate` |
| `REDIS_URL` | yes | none | the compose file builds it from `REDIS_PASSWORD`; set it yourself only with an external Redis (use `rediss://` over a network) | yes | compose | rotate `REDIS_PASSWORD`, restart redis, api, worker |
| `BETTER_AUTH_SECRET` | yes | none | at least 32 characters. **Refused** if short, low variety (fewer than 12 distinct characters) or containing an example word (`changeme`, `secret-secret`, `test-secret`, `load-secret`, `password`, `replace`, `example`, ...). Generate: `openssl rand -base64 48` | yes | ops | rotating signs out every session and invalidates pending reset and verification links; schedule it, keep the old value only for rollback of the same release |
| `APP_URL` | yes | none | the public **web** origin, **https** only (**refused** otherwise); the same value as the web's `APP_ORIGIN`: Better Auth trusted origin, cookie host, Google callback | no | ops | change only with a domain change |
| `DATA_REGION` | yes | none | `eu-west-1` or `eu-central-1` (NFR-02); anything else is refused at every environment | no | ops | n/a |
| `SECRETS_KEY` | yes (or `SECRETS_KEYS`) | none | base64 of exactly 32 random bytes: `openssl rand -base64 32`. **Refused** in production if the decoded bytes have fewer than 12 distinct values (all zeros, a repeated byte or a short pattern); the same for every `SECRETS_KEYS` entry. Encrypts the stored platform secrets (Stripe, Resend, R2). **Back it up separately from the data**: without it stored secrets are unreadable | yes | ops | keyring procedure below |
| `SECRETS_KEYS` | no | none | JSON `{"<kid>":"<base64 32 bytes>"}`; requires `SECRETS_KEY_ID`; satisfies the production requirement instead of `SECRETS_KEY` | yes | ops | the rotation mechanism |
| `SECRETS_KEY_ID` | no | none | picks the current key of `SECRETS_KEYS`; invalid without it | no | ops | change when a new key becomes current |
| `TRUST_PROXY_HOPS` | yes | 1 in production, 0 elsewhere | number of proxies that **append** to `x-forwarded-for` (Cloudflare plus Traefik: `2`; Traefik alone: `1`); 0 to 10. **Refused** at 0 unless `ALLOW_NO_PROXY=1` | no | ops | re-check after any edge change ([dokploy.md](dokploy.md) Edge) |
| `ALLOW_NO_PROXY` | no | unset | passed through by the compose file (empty by default); only `1` counts; lets production run with `TRUST_PROXY_HOPS=0` when the API is reached directly | no | ops | leave unset |
| `AUTH_RATE_LIMIT_PER_MIN` | no | 30 | 1 to 300 in production (more is refused: it would be no limit) | no | ops | tune from `rate_limited_total` |
| `TENANT_CREATE_MAX_PER_USER` | no | 5 | 1 to 1000; most tenants one user may create | no | ops | raise for an agency on request |
| `CLAMD_HOST` | yes | none | the clamd host (`clamav` in compose); **refused** when missing | no | compose | n/a |
| `CLAMD_PORT` | no | 3310 | 1 to 65535 | no | compose | n/a |
| `FILE_MAX_BYTES` | no | 26214400 (25 MiB) | a plan can only lower it; clamd `StreamMaxLength` must be at least this | no | ops | n/a |
| `TASK_EVIDENCE_MAX_BYTES` | no | 26214400 | evidence file limit | no | ops | n/a |
| `TASK_VIDEO_MAX_BYTES` | no | 104857600 (100 MiB) | evidence video; clamd limit at or above it if video is on | no | ops | n/a |
| `TASK_VOICE_MAX_BYTES` | no | 3145728 (3 MiB) | voice notes | no | ops | n/a |
| `METRICS_PORT` | no | off | internal port of the API's `/metrics` and `/readyz/details` (9464 in compose); never published or routed; must differ from `PORT` | no | compose | n/a |
| `WORKER_METRICS_PORT` | no | off | the same for the worker (9465) | no | compose | n/a |
| `METRICS_HOST` | no | `127.0.0.1` | `0.0.0.0` in a container (private network only) | no | compose | n/a |
| `LOG_LEVEL` | no | `info` | `fatal` `error` `warn` `info` `debug` `trace` `silent`; keep `info` | no | ops | raise to `debug` briefly when diagnosing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | unset | Google **sign-in** OAuth client; both or neither | secret: `GOOGLE_CLIENT_SECRET` | ops | rotate in Google Cloud, update here |
| `GOOGLE_INTEGRATION_CLIENT_ID`, `GOOGLE_INTEGRATION_CLIENT_SECRET` | no | unset | the separate OAuth client of the tenant Drive integration; without it the integration answers 503 `integration_not_configured` | secret: `GOOGLE_INTEGRATION_CLIENT_SECRET` | ops | as above |
| `GOOGLE_INTEGRATION_REDIRECT_URI` | no | `${APP_URL}/v1/integrations/google/callback` | the exact redirect URI registered at Google | no | ops | n/a |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | no | unset | Microsoft sign-in OAuth client | secret: `MICROSOFT_CLIENT_SECRET` | ops | rotate in Entra, update here |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | console | unset | **do not set in production**: the platform admin stores billing settings encrypted in the console and they win. Env is a bootstrap fallback (billing answers 503 when neither exists). Not in the compose file | yes | console | rotate in the console. **Live keys: see the go-live checklist (double-checkout risk, first client's plan)** |
| `RESEND_API_KEY`, `MAIL_FROM` | console | unset | same: the console's mail settings win. Not in the compose file | `RESEND_API_KEY` yes | console | rotate in the console |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | console | unset (`S3_FORCE_PATH_STYLE` false) | production uses the Cloudflare R2 settings the platform admin stores; storage fails closed with 503 otherwise. These also drive MinIO in tests and the local profile. R2 shape: endpoint `https://<account_id>.r2.cloudflarestorage.com`, region `auto`, path style true | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` yes | console | rotate in R2 and the console |
| `ALLOW_DEMO_SEED`, `SEED_DEMO_PASSWORD` | no | unset | **refused** by the API and worker in production: they belong to the `seed` job of a demo deployment only | `SEED_DEMO_PASSWORD` yes | ops (demo only) | n/a |

## Web (root `Dockerfile`)

| Variable | Req | Default | Production rule | Secret | Who | Rotation |
|---|---|---|---|---|---|---|
| `API_URL` | yes | none | the API's internal address, no trailing slash (`http://api:8080`). Server only; `scripts/check-bundle.mjs` fails the build gate if it reaches `.next/static`. The server refuses to boot without it (`instrumentation.ts`) | no | compose | n/a |
| `APP_ORIGIN` | yes | none | the public web origin; **the same value as the API's `APP_URL`** (the compose file passes `APP_URL`). The server refuses to boot without it | no | compose | n/a |
| `ENABLE_MOCK_MODULES` | no | unset | **unset** for the first client; `1` on the demo deployment only. Hides or shows the modules with no API behind them (b6-cutover.md). Also a feature flag for [rollback.md](rollback.md) | no | ops | n/a |
| `NODE_ENV` | yes | | `production` (the image sets it) | no | compose | n/a |
| `NEXT_RUNTIME` | no | | set by Next at runtime; selects the Node instrumentation | no | Next | n/a |
| `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED` | no | 3000, 0.0.0.0, 1 | set in the Dockerfile; do not change | no | compose | n/a |

## Compose, ops scripts and demo

| Variable | Used by | Req | Rule | Secret | Who |
|---|---|---|---|---|---|
| `API_IMAGE`, `WEB_IMAGE`, `SEED_IMAGE` | compose | no | pinned image tags for [rollback.md](rollback.md); default is a local build | no | ops |
| `REDIS_PASSWORD` | redis, api, worker | yes | hex, 32+ characters (`openssl rand -hex 32`); the compose file builds `REDIS_URL` from it | yes | ops |
| `SEED_EMAIL_DOMAIN`, `SEED_PLATFORM_TOTP_SECRET`, `SEED_CLEAN_STORAGE`, `SEED_LOCK_TIMEOUT_MS` | `seed` job | no | demo deployment only ([demo-seed.md](demo-seed.md)) | `SEED_PLATFORM_TOTP_SECRET` yes | ops (demo only) |
| `ALLOW_LOAD_SEED`, `BASE_URL`, `ORIGIN` | `npm run load:prepare` and k6 | no | never in production; a throwaway database only (`load/README.md`) | no | tester |
| `DRILL_DATABASE_URL`, `DRILL_CONFIRM_SCRATCH`, `DRILL_PG_CONTAINER` | `deploy/scripts/restore-drill.sh`, `api/scripts/restore-verify.ts` | drill only | a scratch server, never production ([backup-restore.md](backup-restore.md)) | URL yes | ops |
| `PG_SUPERUSER_URL`, `APP_OWNER_PASSWORD`, `APP_USER_PASSWORD` | `bootstrap` service of `deploy/docker-compose.dokploy-demo.yml` only | demo variant | `PG_SUPERUSER_URL` is `postgres://opsdesk_admin:<password>@opsdesk-db-1f0tlc:5432/opsdesk` (the Dokploy Postgres superuser; given to `bootstrap` only, never to api, worker, migrate or web). The two passwords are set as `ALTER ROLE ... LOGIN PASSWORD` on every deploy and must match the ones inside `DATABASE_URL` (app_user) and `DATABASE_OWNER_URL` (app_owner). Never use with `docker-compose.prod.yml` or a client's database | yes | ops (demo only) |
| `LOCAL_POSTGRES_PASSWORD`, `LOCAL_MINIO_USER`, `LOCAL_MINIO_PASSWORD` | profile `local` | local only | throwaway values for a laptop dry run | yes | developer |
| `SMOKE_BASE`, `SMOKE_EMAIL_DOMAIN`, `SMOKE_PASSWORD`, `SMOKE_MOCK`, `SMOKE_ALLOW_REMOTE` | `npm run smoke` | smoke only | against a demo or staging web, never the first client's ([runbook-go-live.md](runbook-go-live.md)) | `SMOKE_PASSWORD` yes | tester |
| `E2E_PG_ADMIN_URL`, `E2E_OWNER_PW`, `E2E_USER_PW`, `E2E_PG_CONTAINER` | e2e stack and `load.yml` | CI only | throwaway local services | no | CI |
| `TEST_DATABASE_URL`, `TEST_DATABASE_OWNER_URL` | api tests | tests only | n/a | no | CI |

## Rotating `SECRETS_KEY` (keyring)

1. Generate a new key: `openssl rand -base64 32`.
2. Set `SECRETS_KEYS={"k1":"<old>","k2":"<new>"}` and `SECRETS_KEY_ID=k2`; remove `SECRETS_KEY` (the keyring satisfies production). Redeploy api and worker. New writes use `k2`; old values still decrypt with `k1`.
3. In the console re-enter and save each stored secret (billing, mail, storage); each save is encrypted under `k2`. There is no automatic re-encryption and the console never shows a stored value, so have the provider values at hand.
4. Remove `k1` only when nothing is stored under it, and keep the old key in the separate key backup until the oldest backup that needs it has expired ([backup-restore.md](backup-restore.md)).
