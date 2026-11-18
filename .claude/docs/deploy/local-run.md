# Local run: the whole stack in one command

Look at the real app (web, API, worker, Postgres, Redis, MinIO) in a browser on your machine. Demo data only, fake credentials, no live provider.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:all` | Starts the containers, prepares the database, seeds it if empty, starts API + worker + web, prints a banner. Ctrl-C stops the three processes and keeps the Docker data. |
| `npm run dev:all:down` | Removes the containers and volumes (project `opsdesk-local`). |
| `npm run dev:all:reset` | `down`, then a fresh start with a freshly seeded database. Stop a running `dev:all` first. |
| `npm run dev:all:totp` | Prints the current 6-digit code of the platform operator. |

Needs Docker running. `npm ci` in the invoking checkout is not needed: the runner (below) installs its own dependencies. A second `npm run dev:all` keeps your data (it seeds only an empty database). The first run pulls images and compiles the web, so allow a few minutes.

## Which code runs: always local `main`

`npm run dev:all` (and `:down`, `:reset`, `:totp`) runs the code of the local `main` branch, from wherever you invoke it (a phase branch, an agent worktree, a half-finished checkout). It does this through a dedicated runner worktree, so your own checkout is never touched:

- The runner lives at `<main checkout>/.local-run/main-checkout` (the folder is gitignored and excluded from lint, tsc and vitest). It is created on first use with `git worktree add --detach` and is **detached**, so it does not hold the `main` branch and `git fetch . x:main` keeps working for everyone.
- On every start the runner is moved to the current tip of `main` (`git checkout --detach main`). If the runner has local edits it refuses with a message and changes nothing.
- `npm ci` runs in the runner only when `package-lock.json`, `package.json` or `api/package.json` changed since the last install (stamp file `.local-run/main-checkout.deps-stamp`) or `node_modules` is missing. A second run reuses everything.
- Migrations run on every start, so a newer `main` with new migrations works against the existing database volume. The demo seed still only runs on an empty database. The Docker project name (`opsdesk-local`) and the volumes are unchanged, so existing local data survives. Logs stay in `<main checkout>/.local-run/{api,worker,web}.log`.
- If `main` does not exist the command fails and says so.

**See which commit runs:** the first line printed and the top of the banner read `Running main @ <short hash> <subject>`.

**Run the current checkout instead** (for developers): `DEV_ALL_USE_CURRENT=1 npm run dev:all` (needs `npm ci` there; the banner then says `Running CURRENT checkout (<branch>)`).

**Clean the runner:** stop `dev:all`, then `git worktree remove --force <main checkout>/.local-run/main-checkout` and delete `.local-run/main-checkout.deps-stamp`. It is recreated on the next run. Developer overrides: `DEV_ALL_RUNNER_DIR` (runner path), `DEV_ALL_BRANCH` (branch to run, default `main`).

## Ports (all overridable by env)

| Service | Default | Env |
| --- | --- | --- |
| Web (Next dev) | 3200 | `LOCAL_WEB_PORT` |
| API | 3201 | `LOCAL_API_PORT` |
| Postgres 16 | 54330 | `LOCAL_PG_PORT` |
| Redis | 63790 | `LOCAL_REDIS_PORT` |
| MinIO | 59100 | `LOCAL_MINIO_PORT` |
| ClamAV (optional) | 53311 | `LOCAL_CLAMAV_PORT` |

They avoid `docker-compose.dev.yml` (5433/6379) and `docker-compose.e2e.yml` (55432/56379/59000, web 3100, API 3101, proxy 3102). Logs: `.local-run/{api,worker,web}.log` (next to the runner).

## Demo accounts (sign in at `http://localhost:3200/sign-in`)

Password for every account: `opsdesk-local-demo-1`

| Role | Email |
| --- | --- |
| Owner (all scope) | `amara.bello@demo.example` |
| Manager (all scope) | `lilianna.novak@demo.example` |
| Manager (Security team) | `daniel.okafor@demo.example` |
| Employee (Cleaning) | `tomasz.wojcik@demo.example` |
| Platform operator | `platform.owner@demo.example` |

The platform operator has 2FA: after the password, enter the code from `npm run dev:all:totp` (the raw TOTP key is `localplatformtotpsecret0123456789`). Its console is at `/platform`.

The mock-only modules are visible (`ENABLE_MOCK_MODULES=1`). Check it with the real-login smoke: `SMOKE_BASE=http://localhost:3200 SMOKE_PASSWORD=opsdesk-local-demo-1 SMOKE_MOCK=1 npm run smoke`.

## ClamAV (off by default)

The API has no switch to skip the malware scan, so without ClamAV uploaded files stay `pending` (they are never waved through). To scan, run with `LOCAL_CLAMAV=1 npm run dev:all` (amd64 image, about 1 GB RAM, 1-2 minutes to load signatures).

## What it reuses

`docker-compose.local.yml` (own project, named volumes), `api/scripts/e2e-prepare.ts` (roles from `api/src/db/bootstrap/roles.sql`, migrations as `app_owner`, MinIO bucket), `api/scripts/seed-demo.ts` (`ALLOW_DEMO_SEED=1`), the env shape of `e2e/stack-env.ts`. Child processes get a minimal environment, so no developer credentials reach them. The script refuses to run if `DATABASE_URL`, `REDIS_URL`, `API_URL`, `S3_ENDPOINT` and similar variables in your shell point anywhere but localhost. It never reads or writes `.env` files. Note that `next dev` itself loads `.env.local` if one exists in the repo: remove it (or keep it free of real values) when you want a purely local run.

## Troubleshooting

- **Port in use**: the script names the port. Free it (`lsof -nP -iTCP:<port> -sTCP:LISTEN`) or pick another, e.g. `LOCAL_WEB_PORT=3300 npm run dev:all`.
- **Docker is not running**: start Docker Desktop, run again.
- **Something is stuck or half-seeded**: `npm run dev:all:down`, then `npm run dev:all` (or `npm run dev:all:reset`).
- **Web does not come up**: read `.local-run/web.log`. The first compile is slow; the runner waits up to 6 minutes.
- **Leftover processes after a crash**: `lsof -nP -iTCP:3200 -iTCP:3201 -sTCP:LISTEN`, kill those PIDs, then `npm run dev:all`.
