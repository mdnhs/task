# Dokploy deployment (B7 Task 19)

Files and docs only: nothing in this repo deploys itself and no step here was run against a live host. The compose file is a reference to copy into a Dokploy **Compose** application (source: this Git repo, compose path `deploy/docker-compose.prod.yml`). Companion pages: [env-matrix.md](env-matrix.md), [migrations.md](migrations.md), [backup-restore.md](backup-restore.md), [rollback.md](rollback.md), [runbook-go-live.md](runbook-go-live.md), [b6-cutover.md](b6-cutover.md) (what to set for the web on the API), [observability.md](observability.md).

## Shape

```
Internet -> Cloudflare (proxy, WAF, TLS) -> Traefik (Dokploy) -> web:3000   (Next standalone, the BFF)
                                                              -> api:8080   (only /webhooks/* from outside)
web  -> api:8080 over the compose network (API_URL=http://api:8080); the browser never calls the API directly
api, worker -> managed Postgres 16 (EU), redis:6379, clamav:3310, R2 bucket (EU)
```

| Service | Image and target | Port (internal only) | Healthcheck | Notes |
|---|---|---|---|---|
| `web` | `Dockerfile` (repo root), target `run` | 3000 | `GET /sign-in` | Server-only env `API_URL`, `APP_ORIGIN`. Never `NEXT_PUBLIC_*`. |
| `api` | `api/Dockerfile`, target `run` (the last stage, what a plain build gives) | 8080, metrics 9464 | compose and image: `GET /healthz` (liveness only, so a Redis or database blip never restarts the container); the deploy gate is `GET /readyz` (database, migration version, Redis) and `/readyz/details` on the internal port, checked by the runbook | Runs under `tsx`, no compile step. |
| `worker` | same image as `api`, command `../node_modules/.bin/tsx src/worker.ts` | metrics 9465 | Redis heartbeat key `worker:heartbeat:<container id>` (`api/scripts/worker-healthcheck.mjs`) | Scans, notifications, exports, the 1 s event relay, recurrence and deadline jobs. Run one or two; the jobs are idempotent. |
| `migrate` | same image as `api`, profile `ops` | none | none (one-shot) | `deploy/scripts/migrate.sh`, runs as `app_owner`. See [migrations.md](migrations.md). |
| `seed` | `api/Dockerfile`, target `seed`, profile `demo` | none | none (one-shot) | Demo deployment only, never started by default, never on a client's database. See [demo-seed.md](demo-seed.md). |
| `redis` | `redis:7`, AOF on, `noeviction`, password | 6379 | `redis-cli ping` | Not authoritative (see [backup-restore.md](backup-restore.md)). |
| `clamav` | `clamav/clamav:stable` | 3310 | `clamdcheck.sh` | About 2 GB of memory and a slow first start (signature download). Set clamd `StreamMaxLength` at or above `FILE_MAX_BYTES` and `TASK_VIDEO_MAX_BYTES`. |
| `postgres`, `minio` | profile `local` only | | | A laptop dry run. Production Postgres 16 and Cloudflare R2 are managed outside the compose file (EU region, NFR-02). |

Stage names are part of the contract: the root `Dockerfile` has `deps`, `build`, `run`; `api/Dockerfile` has `deps`, `app`, `seed`, `run` with `run` last (`api/test/docker-targets.test.ts`, `api/test/deploy-files.test.ts`).

## Use it in Dokploy

1. Create the project, add a **Compose** service, source Git, compose path `deploy/docker-compose.prod.yml`. Keep `Isolated Deployment` on.
2. Paste the names from `deploy/.env.matrix.example` into the **Environment** tab and fill the values there (Dokploy keeps them as its secret store). Fill nothing into a file in the repo. Meaning of each variable: [env-matrix.md](env-matrix.md).
3. **Domains**: one domain for the web (service `web`, port 3000, https, certificate through Dokploy or Cloudflare). A second entry on the **same host** with path `/webhooks` to service `api`, port 8080, so the signed Stripe webhook `POST /webhooks/billing/stripe` reaches the API (the web has no such route; the console shows the URL as `${APP_URL}/webhooks/billing/stripe`). Add no domain, port or label for 9464 or 9465.
4. Build: the compose `build:` blocks use the repo as context. For a registry flow, build once in CI, push to your registry from CI (not from here), set `API_IMAGE` and `WEB_IMAGE` to pinned tags, and Dokploy only pulls. Pinned tags are what makes [rollback.md](rollback.md) work.
5. First deploy and every release follow [runbook-go-live.md](runbook-go-live.md) and [migrations.md](migrations.md): backup, `migrate` with the new image, then api and worker, web last.

## Demo variant on Dokploy

`deploy/docker-compose.dokploy-demo.yml` is the compose file of the demo deployment (opsdesk.raynx.ie). It keeps every hardening of the production file and differs in three ways: Postgres 16 is a separate Dokploy Postgres service on the external `dokploy-network` (api, worker, migrate, bootstrap and seed join it; web, redis and clamav do not), there are no Traefik labels (add the domains in Dokploy), and every deploy runs **bootstrap, then migrate, then api and worker, then web** with no manual step.

- `bootstrap` (`postgres:16-alpine`, one-shot, not profile-gated) waits for Postgres (bounded `pg_isready` loop), runs `api/src/db/bootstrap/roles.sql`, sets the `app_owner` and `app_user` login passwords and creates `pg_trgm`. Safe to re-run. The passwords are read by psql from the container environment (`\getenv`), so they never appear in the process list or logs. Variables: `PG_SUPERUSER_URL`, `APP_OWNER_PASSWORD`, `APP_USER_PASSWORD` ([env-matrix.md](env-matrix.md)).
- `migrate` runs as `app_owner` with the new image; `api` and `worker` start only after it completes successfully.
- **Auto-migration is for the demo database only.** A client's production deploy uses `docker-compose.prod.yml` and the backup-first procedure in [migrations.md](migrations.md).
- `seed` stays profile `demo` and is run once by an operator through a custom command: `docker compose -p <appName> -f deploy/docker-compose.dokploy-demo.yml --profile demo run --rm seed`, with `ALLOW_DEMO_SEED=1` and `SEED_DEMO_PASSWORD` set for that run only ([demo-seed.md](demo-seed.md)).

## Edge

- **One edge, a known number of proxies.** The API reads the caller's address from `x-forwarded-for` in one place (`api/src/core/net/client-ip.ts`) and takes the entry `TRUST_PROXY_HOPS` from the **right**. `TRUST_PROXY_HOPS` must equal the number of proxies that **append** to the header: Cloudflare plus Traefik is `2`, Traefik alone is `1`. Production refuses `0` unless `ALLOW_NO_PROXY=1`. Too low puts everyone in the proxy's rate-limit bucket; too high lets a caller choose their bucket.
- **Traefik must trust Cloudflare.** By default Traefik discards an incoming `x-forwarded-for` from an address it does not trust, which would drop Cloudflare's entry and leave one entry (the count would be 1, not 2). Set the entrypoint's `forwardedHeaders.trustedIPs` to Cloudflare's published ranges (Dokploy: Traefik settings, or the static config of the `websecure` entrypoint). Re-check the ranges when Cloudflare changes them.
- **Check after every edge change** (do both):
  1. From two networks sign in with a wrong password once, then list the limiter keys: `docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "rl:auth-ip:*"'`. Each network must show its own address, not Cloudflare's or Traefik's.
  2. Repeat the wrong sign-in with `curl -H 'x-forwarded-for: 203.0.113.9' ...`: no `rl:auth-ip:` key for `203.0.113.9` may appear (a forged entry sits left of the real ones and is ignored).
- **Webhooks**: `/webhooks/*` on the web host routes to the API host (step 3 above). Stripe's signature is the authentication.
- **Bucket domain (mandatory)**: a presigned URL cannot carry `X-Content-Type-Options`. In Cloudflare, add a **Transform Rule, response header modification** on the bucket domain: set `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. The API already signs `attachment` and the stored mime for every file (b6-cutover.md, download hardening).
- **Bucket CORS** (browser uploads go to the bucket origin): `AllowedOrigins` exactly `APP_ORIGIN`, methods `PUT`, `GET`, `HEAD`, headers `*`, expose `ETag` (b6-cutover.md section 3). Add an R2 lifecycle rule on the `u/` prefix.
- **HSTS and TLS**: set HSTS (`max-age` at least 6 months, after the first clean week) at Cloudflare or as a Traefik middleware; minimum TLS 1.2 (NFR-03) at Cloudflare ("Minimum TLS Version") and in Traefik's TLS options.
- **`/metrics` is never routed.** It lives on its own port (`METRICS_PORT`, `WORKER_METRICS_PORT`) with `GET /readyz/details`, bound to the container's private address (`METRICS_HOST=0.0.0.0` in the compose file). Scrape it from a collector on the same Docker network. Confirm from outside: `curl -sI https://<web-host>/metrics` is a 404 from the web app, never metrics text.
- **Security headers**: the API sets nosniff, no-referrer, CORP and a locked-down CSP on every response itself (`api/src/core/middleware/secure-headers.ts`). Do not add a CORS header at the proxy: the API has no CORS by design and only the web server calls it.

## Logs and alerts

JSON logs to stdout (rotated by the compose `logging` block, 5 x 10 MB per service). Ship them with Dokploy's log drain or the host agent; keep audit-relevant retention at least 12 months (NFR-05). Alert on: `/readyz` failing for 2 minutes, `rate_limited_total` spikes, `queue_job_duration_seconds` growth, worker heartbeat missing, disk above 80%. Wiring a provider (Sentry, OpenTelemetry) is the `ErrorReporter` adapter in [observability.md](observability.md), done at go-live week one.
