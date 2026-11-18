# Migrations runbook (B7 Task 19)

Migrations are numbered SQL files in `api/src/db/migrations/` (drizzle; 47 at the time of writing, 0000 to 0046), applied as `app_owner`. The API connects as `app_user`, which cannot create or alter anything and has no BYPASSRLS.

Note on 0044: it swaps the `shift_types` name unique index to `lower(name)`; on a database that already has case-variant duplicate active shift type names in one location (e.g. "Day" and "day") it fails, so rename them first. 0043 and 0044 were unreleased (never applied outside tests) when 0044 was last edited in place.

## Rules

1. **Additive and backward compatible for one release (expand, then contract).** A migration in release N must leave release N-1's image working: add columns nullable or with a default, add tables and indexes, widen constraints. Dropping, renaming or tightening happens in release N+1, when no running image reads the old shape, with a two-step plan written in that task. This is what makes an image rollback safe ([rollback.md](rollback.md)).
2. **One transaction.** drizzle's migrator applies **all pending migrations in ONE transaction** with one connection. A failure rolls all of them back: the database stays at the previous version, nothing is half applied. Consequences: (a) never put `CREATE INDEX CONCURRENTLY` or anything else that cannot run in a transaction in a migration (a separate manual step, written in the task); (b) session settings leak to the later migrations of the same run, so reset what you set (`set_config('app.tenant_id', '', true)` at the end of a per-tenant loop, as 0040 and 0041 do).
3. **Per-tenant backfills.** Tenant tables are `FORCE ROW LEVEL SECURITY` and the migrator has no BYPASSRLS, so a plain `UPDATE` over a tenant table matches 0 rows and **reports success**. A backfill must loop over `tenants` and `set_config('app.tenant_id', <id>, true)` before each tenant's statements. Reference: `api/src/db/migrations/0041_tenant_created_by.sql`, `api/src/db/migrations/0040_history_cause.sql`. After such a migration, verify with a count that the backfilled column is filled where it should be (the test of the task does; do it on staging data too).
4. **Single runner.** `api/scripts/migrate.ts` takes a session advisory lock (`pg_advisory_lock`), so two `migrate` runs (a double click, two Dokploy hooks) never overlap: the second waits, then finds nothing to do. Do not run migrations from the api or worker start-up; they never do.
5. **Readiness protects you.** `GET /readyz` fails (the instance is not ready, the traffic switch holds) while the applied migration count is **below** what the image ships. A new image started before `migrate` therefore never takes traffic. An older image against a newer database stays ready (the count is above what it expects), which is why rule 1 matters.
6. Extensions: `pg_trgm` (migration 0017) is created by `app_owner` with `CREATE EXTENSION IF NOT EXISTS`. On a managed Postgres it may need **pre-enabling** in the provider console or by a superuser (`CREATE EXTENSION pg_trgm;` in the target database) before the first migrate. Check this in staging first.

## One-time bootstrap (a new database)

1. Create the database in the EU region (Postgres 16). `DATABASE_OWNER_URL` exists only for the `migrate` job below: the api and worker containers are never given it (the API refuses to run in production if it shares a role with `DATABASE_URL`, when both are present).
2. As a superuser, run `api/src/db/bootstrap/roles.sql` once (it is idempotent): it creates `app_owner` and `app_user` (NOLOGIN, NOBYPASSRLS), grants `CREATE` on the database to `app_owner`, and revokes `CREATE` on `public` from everyone else. Managed providers often forbid some of these statements for the admin user: if one is refused, run the equivalent through the provider's role UI and keep the attributes (NOSUPERUSER, NOBYPASSRLS).
3. Give both roles a password and `LOGIN`: `ALTER ROLE app_owner LOGIN PASSWORD '...'; ALTER ROLE app_user LOGIN PASSWORD '...';` Use two different passwords; they go into `DATABASE_OWNER_URL` and `DATABASE_URL` (the API refuses to boot in production if both URLs use the same role).
4. Enable `pg_trgm` if the provider requires it (rule 6).
5. Run migrations as below. **Migration 0000 sets the default privileges** (`ALTER DEFAULT PRIVILEGES FOR ROLE app_owner ... GRANT ... TO app_user`) that every later table relies on: this is why `app_owner` must be the role that runs migrations and why the migration runner is never run as a superuser or as `app_user`.
6. Create the first platform operator: `npm -w api run platform:owner` (2FA is required before any console call).

**Migration 0020** (notification delivery lease) adds `claimed_until` and **replaces a CHECK constraint** on `notification_deliveries` (adds the status `sending`). It is the one early migration that rewrites a constraint: it takes a short lock and validates existing rows, quick at today's size. The older image never writes `sending`, so rolling back past it is safe. Keep it in mind when estimating a very large table in the future.

## Every release

1. **Backup first.** Confirm the managed backup is current and, for a release with a migration, take a logical dump and manifest ([backup-restore.md](backup-restore.md)). Note the current image tags (they are the rollback target).
2. **Staging first.** Run the same release on staging (same compose, separate database) with data resembling production. A migration that touches a tenant table is run against a database with more than one tenant.
3. **Run `migrate` with the NEW image**, as `app_owner` (the one-shot `migrate` service of the compose file is the only container with `DATABASE_OWNER_URL`; if your Dokploy setup cannot run a compose profile, run the same command once from a Dokploy Schedule/Job on the api image with only `DATABASE_OWNER_URL` set: `sh /opt/deploy/migrate.sh` or `../node_modules/.bin/tsx scripts/migrate.ts` in `/app/api`):
   `docker compose -f deploy/docker-compose.prod.yml --profile ops run --rm migrate` (in Dokploy: run the `migrate` service once, or a Schedule/Job with the same command). Expected last line: `migrate: ok (applied N -> M)`. It reads only `DATABASE_OWNER_URL` and prints no connection string.
4. **Roll api and worker** with the new image (api first, wait for `/readyz`, then worker), then **web last**.
5. **Verify**: `GET /readyz` ok on every instance, `readyz/details` on the internal port shows `migrations.applied == expected`, the smoke test passes, the worker heartbeat is healthy.

## If the migration fails

The run is one transaction: the database is unchanged and the error class and code are printed (`migrate: failed (...); the database is at its previous version`). Do **not** roll api, worker or web: the current release keeps serving. Read the error in the database log (the driver message can carry data and is deliberately not printed), fix the migration in a new commit (never edit one that has run anywhere), rebuild, rerun `migrate`. If a lock timeout is the cause, a long transaction holds a table; find it (`pg_stat_activity`) rather than killing at random.

If `migrate` succeeded but the new api misbehaves, go to [rollback.md](rollback.md): migrations are **forward-only**; the old image works against the new schema by rule 1.

Note on 0046: additive only, one nullable column `leave_requests.decision_note` (the approver's note); no backfill, old images ignore it.

Note on 0045: additive only (three nullable `memberships` columns: `deactivated_at`, `last_active_at`, `home_location_id` with a composite FK to `locations` that clears only that column on a location delete, plus its index). No backfill, so existing rows are untouched. Tested by replaying the real file as `app_owner` with no tenant context over seeded tenants.

FK additions on large tables: add the constraint `NOT VALID` first, then `VALIDATE CONSTRAINT` in a later statement, so the table is not locked for the whole scan (0045 skipped this on purpose: `memberships` is small and the new column is all null).
