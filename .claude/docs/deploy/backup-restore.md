# Backup, restore and the restore drill (B7 Task 19, NFR-07)

Targets: **RPO 1 hour, RTO 4 hours**, daily backups with point-in-time recovery, restore tested every quarter. Files and docs only: the provider settings below must be confirmed in the provider's console at go-live; this repo cannot verify them.

## What is authoritative

| Store | Authoritative | Backup |
|---|---|---|
| Postgres 16 (EU, managed) | **Yes**: every tenant row, the audit chain, stored (encrypted) platform secrets, billing mirror | Daily base backup plus WAL for point-in-time recovery |
| Redis | **No.** Queue jobs, rate-limit counters, the read-model version stamp and the worker heartbeat. Lost queue state is rebuilt by the sweeps (notifications, data requests, webhooks, recurrence, deadlines, exports re-enqueue stale work); lost counters only reset limits; the cache refills | None needed. AOF is on only to survive a restart. After a Redis loss: restart the worker, watch `queue_job_duration_seconds` and `event_relay_lag_seconds` |
| Object storage (Cloudflare R2, EU) | **Yes** for uploaded files and exports | **Object versioning on**, plus a lifecycle rule that expires old versions after 30 days. A deleted or overwritten object is recoverable for that window |
| `SECRETS_KEY` / `SECRETS_KEYS`, `BETTER_AUTH_SECRET` | **Yes**, and not recoverable from the data | Backed up **separately from the data**, see below |
| The images | Rebuildable from Git; pinned tags in the registry | Keep the last 5 release tags |

## Postgres backup settings (check these)

- **Managed Postgres (preferred):** confirm in the provider console that (a) automated daily base backups are on, (b) point-in-time recovery is on with WAL shipped continuously (RPO 1 hour needs WAL archived at most every 5 minutes; confirm `archive_timeout` or the provider's equivalent is 300 s or less), (c) retention is **30 days**, (d) backups are encrypted at rest, (e) a copy exists in a **second EU location** (a region or provider different from the primary; NFR-02 still applies, nothing leaves the EU/EEA), (f) the provider's EU region matches `DATA_REGION`.
- **Self-hosted alternative:** `pgbackrest` with a nightly full or differential backup, WAL archiving with `archive_timeout=300`, repository encryption (`repo1-cipher-type=aes-256-cbc`), 30 days retention (`repo1-retention-full=30`, `repo1-retention-full-type=time`) and a second repository (`repo2`) in another EU location. A logical `pg_dump -Fc` is **not** a substitute for PITR; it is what the restore drill consumes (below).
- **Logical dump for the drill and for cutover safety:** `pg_dump -Fc --dbname "$OWNER_URL" -f opsdesk-YYYYMMDD.dump` with a client of the **same major version as the server**, immediately followed by `deploy/scripts/restore-drill.sh --write-manifest --source-url "$OWNER_URL" --manifest opsdesk-YYYYMMDD.manifest.tsv`. Take both on a quiet moment so the counts match; the drill has `--tolerance-rows` for the rest. Store the dump encrypted (for example `age` or `gpg`), never next to the keys.
- `roles.sql` is not part of the dump: roles are cluster-level (`api/src/db/bootstrap/roles.sql`); the drill and a rebuild both apply it first.

## Keys: back them up apart from the data

Restoring data without `SECRETS_KEY` (and the keyring ids) makes every stored secret (Stripe, Resend, R2 settings) unreadable, and without `BETTER_AUTH_SECRET` sessions and pending links break. Keep an encrypted copy of these in a password manager or vault **owned by a different person or system than the database backups**, and record in it which key id is current. When you rotate ([env-matrix.md](env-matrix.md)), keep the old key until the oldest backup that needs it has expired.

## The restore drill (quarterly, and once before client data)

Script: `deploy/scripts/restore-drill.sh` (also `restore-drill.sh --self-test`, which proves the script itself against a throwaway Postgres 16 in Docker seeded with the demo data; it needs Docker and `psql`, and runs in `api/test/deploy-files.test.ts` when Docker is up).

Run it from an ops host (or a CI runner) that has the repo with `npm ci` done, the PostgreSQL client tools of the server's major version, and network access to a **scratch Postgres server that is not production** (a superuser connection):

```
export DRILL_CONFIRM_SCRATCH=yes
deploy/scripts/restore-drill.sh \
  --dump opsdesk-YYYYMMDD.dump \
  --manifest opsdesk-YYYYMMDD.manifest.tsv \
  --admin-url "postgres://postgres:<password>@<scratch-host>:5432/postgres"
```

It: creates `restore_drill_<epoch>`; applies `roles.sql`; `pg_restore --exit-on-error` (nothing is migrated); counts rows **per tenant per tenant table** (every base table with a `tenant_id` column, found from the catalog, so a new table is covered automatically) and compares with the manifest; runs `api/scripts/restore-verify.ts`, which recomputes the audit hash chain of **every tenant**; prints the elapsed time against the 4 h budget; drops the scratch database (`--keep` keeps it). Exit codes: 0 pass, 1 counts differ, 2 an audit chain is broken, 3 restore failed, 4 usage or a missing tool.

Procedure for a real drill (NFR-07):

1. Start the clock. Pick the latest backup. For **PITR**, restore the managed backup to a new scratch instance at a chosen timestamp (for example 30 minutes before now) using the provider's restore function and time how long that takes; then run the manifest and chain checks against that instance (`--write-manifest` against production at the same time gives the comparison, with `--tolerance-rows` for writes in between).
2. For the **logical dump**: run the script above.
3. Check the R2 side: restore one object from a previous version (versioning) and open it.
4. Check a key: decrypt one stored secret with the backed-up key on the scratch instance (start the api against it with `DATABASE_*` pointing at the scratch database and open the console storage page) to prove the key backup works.
5. Record in the drill log: date, who, backup used, restore time, total time against 4 h, the count and chain results, and any gap. A drill over 4 h or with a failed check is a finding with an owner and a re-run date.
6. Destroy the scratch instance.

**Gate:** one drill, with its time recorded, must be done before the first client's data goes in ([runbook-go-live.md](runbook-go-live.md)).

## If production data is lost or corrupted

1. Stop writes: scale `web` and `api` to zero (maintenance page at Cloudflare). Leave the worker stopped too.
2. Decide the target time (last known good). Restore **point-in-time** to a new instance in the same EU region; verify with the drill's checks; point `DATABASE_URL` and `DATABASE_OWNER_URL` at it.
3. If a bad migration caused it, see [rollback.md](rollback.md) (database rollback is restore-based).
4. Start the worker and api, then web; run the smoke test; tell the clients affected by the RPO window which data to re-enter. If personal data was exposed, follow the incident steps in [security-review.md](security-review.md) section 9.
