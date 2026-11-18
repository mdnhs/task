# Load test (B7 Task 17)

k6 scenarios for the 250-user target of NFR-08. **Localhost only**: the scripts refuse any `BASE_URL` that is not `localhost`, `127.0.0.1` or `[::1]`, and the seed refuses a database that is not local. Never point it at a client's deployment.

## Run it

```bash
npm run e2e:stack                 # Postgres 55432, Redis 56379, MinIO 59000, ClamAV 53310 (fake credentials, throwaway)
# one-time per database: roles + migrations (apiEnv in e2e/stack-env.ts has every variable; the API below needs them too)
(cd api && npx tsx scripts/e2e-prepare.ts)

# the load tenant: `loadtest`, 250 users (1 owner, 10 ops managers, 239 employees), 10 000 tasks, one daily shift everybody reports on
ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=<12+ chars> npm run load:prepare -- [--users 250] [--tasks 10000]
#   writes load/.users.json (session cookies of the throwaway users; gitignored, mode 0600, never printed)

# the API (and the web for the BFF profile), then k6
BASE_URL=http://localhost:3100 npm run load:smoke                                  # through the BFF (web origin): 5 users, 1 minute
BASE_URL=http://localhost:3100 k6 run load/k6/scenarios.js                         # the 250-user profile
BASE_URL=http://localhost:3101 TARGET=api METRICS_URL=http://127.0.0.1:9464/metrics k6 run load/k6/scenarios.js   # straight at the API, with the pool series
```

| Variable | |
|---|---|
| `BASE_URL` | Default `http://localhost:3100`, the web origin: the BFF forwards `/v1/*` to the API (cookie `od-tenant` names the tenant). |
| `TARGET` | `bff` (default) or `api` (the API port directly: header `X-Tenant`, `Origin` = `ORIGIN`, which must equal the API's `APP_URL`). |
| `METRICS_URL` | Optional, the API's internal metrics port (`METRICS_PORT`). Adds a 1-VU scraper (every 5 s) and the `db_pool_waiting` threshold. |

`load:prepare` is guarded like the demo seed (`ALLOW_DEMO_SEED=1` always; `NODE_ENV=production` additionally needs `ALLOW_LOAD_SEED=1`; both database URLs local and one database; no tenant besides `loadtest` and the three demo tenants; no account outside `@demo.example`; `loadtest` must not exist yet). Use a fresh database per run: a report can be submitted once, and the VUs take one shift date per submit. In CI: the manual workflow `.github/workflows/load.yml` (`workflow_dispatch`, profile `smoke` or `full`).

## Scenario (NFR-08)

250 virtual users, ramp 2 min, hold 10 min, ramp down 1 min. Each iteration picks one action by weight, then thinks 1 to 5 s. A VU is one user of the users file for the whole run.

| Weight | Action | Request(s) | `kind` |
|---|---|---|---|
| 20 | dashboard | `GET /v1/dashboard` (ops, owner) or `GET /v1/dashboard/staff` (employees) | read |
| 25 | tasks list | `GET /v1/tasks?limit=50` | read |
| 15 | task detail | `GET /v1/tasks/{id}` (an id of the VU's last list) | read |
| 15 | Today | `GET /v1/today` | read |
| 10 | shift report draft save | `POST /v1/shift-reports/open` (yesterday, once) then `PUT /v1/shift-reports/{id}/draft` | write |
| 5 | report submit | open (an older, unused shift date), `PUT` draft, `POST /v1/shift-reports/{id}/submit` | write |
| 5 | search | `GET /v1/search?q=...&limit=10` | read |
| 5 | notifications | `GET /v1/notifications?limit=20` | read |

Every request carries the tags `kind` (`read` or `write`) and `name` (the step).

## Thresholds (`load/k6/thresholds.json`, the single source; a miss fails the run)

| Threshold | Why |
|---|---|
| `http_req_duration{kind:read}` p(95) < 500 ms | read budget (NFR-08) |
| `http_req_duration{kind:write}` p(95) < 800 ms | write budget |
| `http_req_duration{name:report_submit}` p(95) < 2000 ms | report submit on the 4G budget, measured server side |
| `http_req_failed` rate < 1 % | errors |
| `checks` rate > 99 % | every step checks its status code |
| `rate_limited` count = 0 | no 429 in the steady state (the global limits must not bite 250 normal users) |
| `db_pool_waiting` p(95) < 1 (so 0) | nobody waits for a Postgres connection; only with `METRICS_URL` (the series is scraped from the API's `/metrics`) |

The smoke profile (`load/k6/smoke.js`, 5 VUs for 1 minute) uses the same thresholds and runs in the e2e stack.

## Results

Run on 2026-11-18, one MacBook running k6, one API process (`tsx src/server.ts`, no worker), Postgres 16 and Redis 7 in Docker, straight at the API (`TARGET=api`, the web/BFF was not part of it). The `loadtest` tenant: 250 users, 10 000 tasks, 250 daily-shift assignments. This is an upper bound of what one idle machine does, not a capacity statement for production hardware or the BFF hop.

| | 250 users, 13 min (second run) | smoke, 5 users, 1 min |
|---|---|---|
| requests | 63 453 (81/s) | 120 |
| read p(95) / p(99) | 35 ms / 77 ms | 128 ms |
| write p(95) / p(99) | 29 ms / 63 ms | 51 ms |
| report submit p(95) | 36 ms | 66 ms |
| `http_req_failed` | 0.00 % | 0.00 % |
| checks | 100 % (63 297) | 100 % |
| 429 | 0 | 0 |
| `db_pool_waiting` p(95) | 0 | 0 |
| all thresholds | pass | pass |

The first 250-user run (same data shape, earlier script) failed `http_req_failed` (2.19 %) and `checks` (97.79 %): 1 382 report submits answered `422 report_invalid`, because the script left the shift's task rows in their default status. The script was fixed (every row is sent as done, like a member would) and the thresholds were not touched; latencies were the same in both runs (read p(95) 39 ms).

Not covered here, by design: the BFF hop (needs the web built and running), two API instances (cache stamp traffic), the worker running beside the API, and the 4G network part of the 2 s submit budget (the threshold is the server-side share).

## EXPLAIN pass

`api/scripts/explain.ts` turns `auto_explain` on for the app role of the local Postgres, calls each scenario endpoint once as the right persona (warm-up first, except the read models whose 30 s cache would hide their queries), reads the plans (`EXPLAIN ANALYZE, BUFFERS`) back from the container log and prints one row per endpoint. Prepared tenant, 10 000 tasks, 3 333 pending evidence rows:

| endpoint | statements | slowest | highest plan cost | Seq Scan over 1 000 rows |
|---|---|---|---|---|
| tasks list (employee) | 18 | 18.8 ms | 44 687 | none |
| dashboard (manager, all scope) | 32 | 14.8 ms | 44 353 | `tasks` 10 000 rows, `task_evidence` 3 333, `task_assignees` 10 000 |
| report draft save | 20 | 0.4 ms | 480 | none |
| dashboard (employee) | 20 | 0.5 ms | 300 | none |
| Today | 27 | 0.7 ms | 300 | none |
| task detail, report open, search, notifications | 9 to 19 | 0.1 ms | 28 | none |

The top three by cost:

1. **tasks list** (`GET /v1/tasks`, employee): `Index Scan using tasks_live_due_idx`, `Rows Removed by Filter: 9958`, 10 076 buffers, 18 ms. The own-scope filter is `creator OR reviewer OR id IN (my assignments)`; an OR over a sub-select cannot use an index range, so the plan walks the tenant's live tasks in due order until it has 51 rows (an employee with 42 tasks reads them all). It is an index scan, not a sequential scan, and 18 ms is far inside the 500 ms read budget. An index does not change this plan; a rewrite (assignments first, then the task rows) would, and is a query change, not an index.
2. **dashboard summary** (manager): one `Aggregate` over `Seq Scan on tasks` (10 000 rows, 4 ms) plus a sub-plan probing `task_assignees_user_idx` (index-only scans, 1 250 loops). A count over the whole tenant's tasks reads every row whatever the index, so the sequential scan is the right plan: 14.8 ms, cached for 30 s per scope.
3. **report draft save**: `Nested Loop` from `task_assignees_user_idx` (42 rows) into `tasks_pkey`, 0.4 ms.

**Decision: no change, no index migration.** The only sequential scans over 1 000 rows are whole-tenant aggregates where a scan is the cheapest plan (an index adds nothing and costs every write), and no query is outside its budget by more than two orders of magnitude. Revisit when a tenant holds more than ~100 000 live tasks (the rewrite of the own-scope list above is the first candidate).
