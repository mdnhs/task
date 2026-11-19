# Demo seed (`npm -w api run seed:demo`)

Loads the mock JSON in `public/data/**` into Postgres as three demo tenants, so the front end can run against the real API with the same people, tasks
and reports the mock showed. **Demo data only.** It writes a lot of rows and creates users with a password, so it is guarded before it writes anything.

## Run it

```bash
# 1. backing services and an empty database, migrated (roles.sql once, as a superuser, then the migrations as app_owner)
docker compose -f docker-compose.dev.yml up -d --wait postgres redis

# 2. the seed (connects as app_user; app_owner is used only to re-seed or --reset)
ALLOW_DEMO_SEED=1 \
SEED_DEMO_PASSWORD='a-password-of-12-or-more-characters' \
DATABASE_URL=postgres://app_user:...@localhost:5433/opsdesk \
DATABASE_OWNER_URL=postgres://app_owner:...@localhost:5433/opsdesk \
BETTER_AUTH_SECRET=... APP_URL=http://localhost:3000 \
npm -w api run seed:demo -- [--reset] [--anchor 2026-12-01]
```

| Variable | |
|---|---|
| `ALLOW_DEMO_SEED=1` | **Required, always** (not only in production). Anything else, or unset, is `refused: opt_in_required`. |
| `SEED_DEMO_PASSWORD` | **Required**, 12+ characters, no default, never committed, logged or printed. Every demo user signs in with it. |
| `DATABASE_URL` | `app_user`. All writes go through the same RLS (`app.tenant_id`) as the API. |
| `DATABASE_OWNER_URL` | Needed only to re-seed an existing demo tenant (it deletes and re-inserts the tenant's seeded rows, which the app role may not delete) or for `--reset`. Without it a re-run is `refused: owner_required`. |
| `BETTER_AUTH_SECRET`, `APP_URL` | Same values as the API (password hashing, sealing the platform owner's TOTP secret). |
| `SEED_EMAIL_DOMAIN` | Default `demo.example`. Must end in a reserved name (`.example`, `.test`, `.invalid`, `.localhost`, or `example.com/net/org`), so no demo address is a real mailbox. |
| `SEED_PLATFORM_TOTP_SECRET` | Optional. Creates `platform.owner@<domain>` (verified, 2FA enrolled with this secret, platform owner). The value is the raw TOTP key string, 16+ characters of `A-Za-z0-9`; your authenticator needs its base32 form (`echo -n "$SEED_PLATFORM_TOTP_SECRET" \| base32`). Without it no platform owner is created (use `npm -w api run platform:owner` as before). |
| `--anchor YYYY-MM-DD` | The day the mock's frozen "today" (2026-10-20) becomes. Default: today in the tenant timezone. |
| `--anchor latest-report` | Tasks anchor on today as usual, and the **newest mock report day lands exactly on today** (shift and report dates keep the exact offset, so a weekday can differ from its pattern; the run prints a warning). The default keeps weekdays instead and can leave the newest report up to 6 days before today. |
| `SEED_LOCK_TIMEOUT_MS` | Optional, default `30000` (1 to 600000). How long the seed waits for the seed lock; then `refused: lock_timeout` and nothing is written. A stuck or killed seed on another connection can never make a new one hang. |
| `SEED_CLEAN_STORAGE=1` | Optional. With the usual `S3_*` variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`), `--reset` also deletes the demo files' objects (`t/<tenant>/<file>` and `u/<tenant>/<file>`) from that bucket. Off by default: a reset never touches a bucket you did not name, it prints a warning with the number of files that may still have an object. |
| `--reset` | Deletes the three demo tenants and the demo users first (new ids), then seeds. Everything that carries a demo `tenant_id` goes, including tables without a foreign key to `tenants` (the sweep reads `information_schema`, so a table added later is covered; `api/src/seed/demo/seed.test.ts` fails otherwise). Never touches any other tenant (see the guards: a database with another tenant is refused before anything is deleted). |

## Guards (checked before any write and again under a lock; there is no flag that skips them)

**T6.9 (e2e) and any compose or deploy setup that runs the seed must set `ALLOW_DEMO_SEED=1`** (it is required in every environment, not only production).

1. `ALLOW_DEMO_SEED=1` must be set. `NODE_ENV=production` without it is the same refusal; with it the checks below still apply.
2. The database must hold **no tenant other than** `northgate`, `harbourline`, `millbrook` (exact slugs). A host name cannot tell a demo database from a
   production one, so this is the real guard: a database with a real customer in it is `refused: other_tenants`, whatever the environment says.
3. The database must hold **no account outside the demo email domain** (`refused: foreign_users`), e.g. real sign-ups made before the first tenant.
4. `SEED_DEMO_PASSWORD` is 12+ characters (`refused: password_required`).
5. **Two connections, one database.** The guard runs on the owner connection (when `DATABASE_OWNER_URL` is given: the owner sees every row whatever RLS says) AND on `DATABASE_URL`, and the two must be
   the same database (name, server port and address, plus the cluster `system_identifier` when both roles can read it): otherwise `refused: connections_differ`. Without this a wrong env could make the guard
   vouch for one database while `--reset` deletes in another.
6. **Seed lock and re-check.** Immediately before the first write the seed takes a session advisory lock (two seeds never interleave) and runs the guard again. Covered: the check-to-write window of
   concurrent seeds and a foreign tenant created before the lock. Not covered: a non-seed process creating a tenant after the re-check (tenant creation takes no such lock, and a table lock would block the seed's own writes).
   That window cannot hurt foreign data: every delete names the three demo slugs and every write goes to a demo tenant or a demo-domain user.

Refusals print one safe code (`refused: <code>`) and write nothing. A failure prints only the error class and SQLSTATE, never a message (messages can carry SQL parameters).

## What it creates

- Three tenants (`shell/tenants.json` and `billing/subscription.json`): `northgate` (business, active, the full dataset), `harbourline` (starter, trialing),
  `millbrook` (business, past_due). The last two hold only their owner. Tenant name, brand colour, timezone, currency, locale and report deadline come from the mock; code knows none of them.
- 22 users in `northgate`: the 14 of `settings/users.json`, the 6 people only `tasks/people.json` knows (matched by name; the others get `<name-slug>@demo.example`) and the 2 people only the roster files name
  (`s-bell` Marcus Bell, an employee; `s-grant` Oliver Grant, a deactivated membership: he left on 31 Oct). The other `s-` ids of the roster files are accounts under another key (M. Haddad, J. Silva, A. Kowalski, matched by name via `staff-rosters/staff.json`).
  All verified, no 2FA, role keys as in `shell/roles.json`. `amara.bello@demo.example` (owner) is also the owner of the other two tenants, so the tenant switcher has 3 entries.
  Two users (`chloe.barnes`, `marek.nowak`) are deactivated memberships, as in the mock.
- Teams (Security, Cleaning, departments) with their members and the reporting lines verbatim from `shifts/members.json`; shift patterns, assignments and the reporting defaults;
  6 devices **registered but unbound** (no enrolment code, no binding secret: a persona is "on the company PC" only after the enrolment flow) and the Drive device policy.
- 2 projects with 4 milestones, 3 task templates, 61 tasks with their refs (`TSK-1001` ... the next created task is `TSK-<max+1>`), history from `timeline`, checklists, notes as comments,
  dependencies, the weekly repeat series, evidence items; 17 shift reports with items, frozen versions and reviewer comments; the report template, public holidays, and the demo person's in-app notifications.
- Every date is **re-anchored**: the mock's `2026-10-20T09:00` becomes the anchor day, every other date keeps its distance from it, and local wall times are kept across DST
  (17:00 stays 17:00 on both sides of the October clock change). So the overdue / due-today / submitted counts are the mock's, on any day.
  Dates with no weekday meaning (tasks, subscription dates) move by the exact offset. **Weekday-bound dates (shift assignments and report shift dates) move by a whole number of weeks**: the
  largest multiple of 7 that keeps the latest report on or before the anchor day, so every report stays on a day its pattern runs and no submitted report is in the future. When that differs from the
  exact offset the run prints `warning: shift dates moved by N days (not M) to keep weekdays` (also `shiftOffsetDays` in the report).

## Rosters (M1A, B8 Task 18) and the personas that can edit them

`northgate` gets `public/data/rosters/*.json` as raw inserts with deterministic ids (`detId(tenant, "roster-<kind>", <mock id>)`, so a re-seed keeps every id): 3 locations (opening-hours lines like `Mon-Sat 08:00-22:00` become per-day keys), the
supervisor grants of `access.json`, 7 shift types and their weekday targets, the rules the tenant chose (`roster.rules` setting), home sites and qualifications (one expires within a month of the anchor, one has no end date),
4 weeks (3 published, 1 draft) with 51 shifts (6 open, some confirmed), history (the mock's lines in the service's action names plus a publish line for every published week), a change request, a claim, 4 leave requests (approved,
requested, rejected), availability windows and 2 saved week layouts. The seeded data contains the rule breaks the engine must flag (a double booking at Coppers on the Friday, a 1-hour rest for J. Silva, approved leave and an unavailable window).
Everything with a date moves by **whole weeks** (a Monday stays a Monday, also with `--anchor latest-report`, which moves other dates by days) and every wall time is kept: the instants are computed in the location's zone, so 18:00 is 18:00 on both
sides of a clock change. Not seeded: the office-limits row of `access.json` for Priya Shah (she is HR, read-only: a limit means nothing without an office role), and `staff-rosters/{incidents,roster-gaps}.json` (FE-only incident and cover model).

Who can edit rosters (the role templates in `public/data/shell/roles.json` are untouched; the demo tenant's own `ops` and `supervisor` roles were given a roster level, as a tenant owner could in the role editor):

| Persona (password `SEED_DEMO_PASSWORD`) | Role | Roster level | Sites they see and edit |
| --- | --- | --- | --- |
| `amara.bello@demo.example` | owner | office (template) | all 3 (Coppers, Docklands Plaza, Liffey Retail Park); publishes, rules, grants |
| `rhys.edwards@demo.example` | admin | office (template) | all 3 |
| `lilianna.novak@demo.example` | ops, the all-scope manager | office (demo tenant role) | all 3, no limits |
| `ismail.rahman@demo.example` | supervisor | supervisor (demo tenant role) | Coppers only (grant of `access.json`); drafts and publish-by-supervisor rules apply, another site is 404 |
| `daniel.okafor@demo.example` | supervisor | supervisor (demo tenant role) | Docklands Plaza only |
| `grace.mensah@demo.example` | supervisor | supervisor, no grant | none: the roster page shows no site (she is homed at Liffey as a member, which is not a grant) |
| `priya.shah@demo.example`, `ibrahim.khan@demo.example` | hr, auditor | none | no roster access |
| employees (`marcus.hill`, `leo.fernandez`, `m.haddad`, ...) | employee | staff | their own shifts, leave, availability, claims and swaps |

The default `location-supervisor` role template keeps `attention: none`: its task attention items are tenant-wide (task scope `all`), not limited to the supervisor's sites (verified by a test in `rosters/attention.test.ts`).

## Idempotent and re-runnable

A re-run on its own demo tenants gives the same tenants, users (same ids), memberships and task refs, and moves every date to the new anchor. It needs `DATABASE_OWNER_URL`: the tenant's
seeded rows (tasks, reports, teams, shifts, devices, notifications, search index, ...) are deleted as the table owner and re-inserted; the tenant, roles, memberships, subscription, settings,
users and the **audit chain** are kept (each run appends `tenant.demo_seeded`; the chain stays valid). Row ids of the re-inserted rows are deterministic for tasks, reports, evidence, comments and
notifications (a task's id survives a re-run) and fresh for rows created through the services (teams, patterns, projects, ...).

## Invariants

The seed calls the same services the API does, acting as the demo owner (`createTenant`, teams, reporting lines, shift patterns and assignments, devices, projects, milestones, templates,
`changeSubscriptionTx`), so RLS, composite foreign keys, audit hash chains (`verifyChain` is ok for every tenant), role locks and domain events are the real ones. Historic rows no service can express
(tasks with refs and history, reports with frozen versions, evidence, notifications, memberships) are raw inserts that keep the same invariants and publish the same events.
Search is filled by running the event relay once with **only the search indexers registered**: every seeded event is delivered to the index and marked relayed, so no notification, email or webhook subscriber ever sees a seeded event.

## Never contacts a provider

No Stripe (subscriptions carry no provider ids), no Resend (the mailer is a counter; the verification mail of each sign-up is swallowed), no R2/MinIO (nothing is uploaded), no job queue (an in-memory recorder; `jobsQueued` is 0).
Evidence files and report attachments are therefore metadata only: evidence items that need a file get a clean `files` row with no object (the name, count and review state render, downloading fails), report attachments are skipped.
Both are listed in the run's `warning:` lines.

## What is not seeded (and why)

Printed as `not seeded:` lines on every run. FE-only features with no backend module stay on the mock (rulings I16, J2): the FE-only incident and cover model of `staff-rosters`, `orders`, `recruitment`, `payroll`, `files`, `assistant` (`rosters/*` is seeded since B8 Task 18).
Also not loaded: `platform/*` (platform plans, invoices and tenants are platform data), `billing/{invoices,usage,entitlements}.json` (the provider, the computation and the API's own data), the read models the API computes
(`dashboard`, `attention`, `search`, `audit`) and display-only `settings/*` files.

## Tests

`api/src/seed/demo/*.test.ts` (Testcontainers): guards (empty database, demo-only database, another tenant, production with and without the opt-in, missing opt-in, foreign users, no bypass argument, nothing written on a refusal),
row counts equal the JSON, re-anchoring and DST, refs and the counter, sign-in of the personas, platform owner with TOTP, idempotency, `--reset`, the real routes reading the seeded data, and the CLI as a child process.

## The seed as a container image (a separate target, never the API)

`api/Dockerfile` has four stages: `deps`, `app` (shared code, no `CMD`), `seed` and `run`. **`run` is the last stage**, so a plain `docker build -f api/Dockerfile .` (and CI, and Dokploy without a target) builds the API. The
demo seed is built only on purpose:

```bash
docker build -f api/Dockerfile --target seed -t opsdesk-seed:local .
docker run --rm --network host \
  -e ALLOW_DEMO_SEED=1 -e SEED_DEMO_PASSWORD=... -e DATABASE_URL=... -e DATABASE_OWNER_URL=... -e BETTER_AUTH_SECRET=... -e APP_URL=... \
  opsdesk-seed:local                      # add flags by a full command: ../node_modules/.bin/tsx scripts/seed-demo.ts --reset
```

- The image is labelled `com.opsdesk.purpose=demo-seed` and `opsdesk-demo-seed`; its `CMD` is the seed script (`api/test/docker-targets.test.ts` pins: run is last and starts `src/server.ts`, seed starts `scripts/seed-demo.ts`, `app` has no `CMD`, nothing builds on `seed`).
- It sets **no** opt-in, password or database URL: the operator passes them at run time, and every guard above still applies. Do not deploy it as a service; it is a one-shot job. In compose use `build: { context: ., dockerfile: api/Dockerfile, target: seed }` and `restart: "no"`, never in a production compose file.
- The seed image holds the same code and dependencies as the API image; it is not a smaller or different build. Keep it out of production registries' deploy tags (tag it `opsdesk-seed:*`).
