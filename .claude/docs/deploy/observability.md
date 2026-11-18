# Observability: logs, metrics, readiness, error reports (B7 Task 15)

No vendor SDK and no live provider is needed for any of this (ruling S10). A Sentry or OpenTelemetry adapter is a later file that implements `ErrorReporter`.

## Request context and logs

- Every response carries `x-request-id`. An incoming one is reused only when it is 8 to 64 characters of `A-Z a-z 0-9 - _` (a uuid, a trace id); anything else is replaced by a fresh uuid.
- **The request id follows the job (B8 Task 16).** A job enqueued while a request is served carries that request's id in its ENVELOPE (the BullMQ job options, key `requestId`; `api/src/core/queue/request-context.ts`: the request-id middleware keeps it in an `AsyncLocalStorage`, `queue.add` stamps it), a job the event relay enqueues carries the EVENT id, and the worker runs the handler with a child logger bound to it, so every worker log line of that job has `requestId`. It is never put into the job `data` (job schemas, ledgers and `jobId` hashes are unchanged: golden tests pin them) and is only a correlation label: it is length- and charset-checked (8 to 64 of `A-Z a-z 0-9 - _`) when stamped and again when read, and never an identifier for authorization. Jobs enqueued by a sweep or a scheduler have none.
- Logs are structured JSON (pino), built by `makeLogger` (`api/src/core/observability/logger.ts`) in the API, the worker and the demo seed. Fields: `service` (`api`, `worker`, `seed`), `requestId`, `tenantId` and `userId` once the request resolved them, `route` as the route **template**.
- One access-log line per request (`msg: "request"`): `method`, `route` (`/v1/tasks/{id}`, or `unmatched`), `status`, `durationMs`, `bytes`, ids. Never the query string, a header, a cookie or a body.
- Redaction: one exported path list (`LOG_REDACT_PATHS`) plus a deep scrub of every logged object (any depth, any case): authorization, cookie, set-cookie, password, token, secret, api keys, signatures, one-time codes (`otp`, `totpCode`, a 6 to 8 digit `code`) are `[redacted]`; `body` and `payload` fields are dropped; bearer tokens, `odk_`/`whsec_`/`sk_` strings and the local part of an email address are masked inside text. An `Error` is logged as its class name and pg code only (the B2 rule: Drizzle messages carry query parameters).
- `LOG_LEVEL` (default `info`) sets the level.

## Error reports

`ErrorReporter.capture(err, { requestId, tenantId, userId, route, jobName, jobId })`. The default writes one error line (class name, pg code, ids); tests inject `fakeErrorReporter()`. An unhandled error is reported with the request id and answers a generic `500 internal` problem+json: never a stack, never a message. Worker job failures log `job`, `jobId`, `requestId` (when the job data carries an id-shaped one) and the error class, never the payload. Swap the reporter in `makeDeps` (`api/src/server.ts`).

## Metrics (internal port only)

- `METRICS_PORT` (API) and `WORKER_METRICS_PORT` (worker): off when unset. `METRICS_HOST` defaults to `127.0.0.1`. A container sets it to its private-network address; **never publish the port, never route it through the public proxy / Cloudflare**, and do not map it in `docker-compose.prod.yml`. It must differ from `PORT` (the API refuses to start otherwise). The public app has no `/metrics`.
- Prometheus text at `GET /metrics`. Series: `http_requests_total{method,route,status_class}`, `http_request_duration_seconds{route}`, `db_pool_waiting`, `queue_jobs_total{name,result}`, `queue_job_duration_seconds{name}`, `sweep_tenants_processed{job}`, `event_relay_lag_seconds`, `rate_limited_total{bucket}`, `last_active_stamp_total{result}` (a failed member last-active stamp is counted and swallowed, never a failed request).
- The tenant id is never a label (cardinality); a label named like a tenant id throws in the registry. The tenant id is a log and error-report field only.

## Health and readiness

- `GET /healthz`: liveness, no dependencies.
- `GET /readyz` (public): `200 {"status":"ready"}` or `503 {"status":"unavailable"}`, nothing else (no check names, counts or flags). The result is shared by concurrent callers and cached for 2 s, so a flood costs one set of queries per window.
- `GET /readyz/details` (internal listener on `METRICS_PORT` only, same cache): each check named: `checks.db` (`select 1`), `checks.redis` (limiter store ping), `checks.queue` (queue connection ping), `checks.migrations` (`expected` = migrations in this build, `applied` = read through the `schema_migration_count()` function of migration 0042; behind is not ready). `storage.configured` is a presence flag (stored settings or `S3_*` env), informational. A failed check is `{ ok: false }` with no error text, host or connection string. No mail, billing, storage or Google call is made.
- The access log never reads a response body (exports are streamed): `bytes` is the `content-length` header or null. The `method` label of the http metric is an allow-list (anything else is `other`) and the `bucket` label of `rate_limited_total` is a static name (anything else is `other`).

## Alert rules

| Alert | Rule |
|---|---|
| 5xx rate | `sum(rate(http_requests_total{status_class="5xx"}[5m])) / sum(rate(http_requests_total[5m])) > 0.01` for 5 min |
| Latency | p95 of `http_request_duration_seconds` above 500 ms for 10 min |
| Not ready | `/readyz` failing for 2 min |
| Queue age | oldest waiting job older than 5 min (BullMQ queue age; `queue_jobs_total{result="failed"}` rising is the companion) |
| Relay lag | `event_relay_lag_seconds > 30` |
| Backups | newest backup older than 26 h (see the backup runbook, Task 19) |
| Rate limits | sustained `rate_limited_total` growth on one bucket (abuse or a wrong `TRUST_PROXY_HOPS`) |
| Pool | `db_pool_waiting > 0` for 5 min |
