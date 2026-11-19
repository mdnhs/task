# Rollback runbook (B7 Task 19)

**Migrations are forward-only.** There are no down migrations and none will be written. A rollback is an **image rollback** (code), made safe by the rule that every migration is additive and backward compatible with the previous image for one release ([migrations.md](migrations.md) rule 1). A **database** rollback is a restore, and is a last resort.

## Pin tags so there is something to roll back to

Deploy by tag, never by `latest`: set `API_IMAGE` and `WEB_IMAGE` (and `SEED_IMAGE` for a demo) in the Dokploy environment to the release tag (for example the Git SHA). Before every release, write the current tags in the release note. Keep the last 5 tags in the registry.

## Choose the case

| Symptom | Action |
|---|---|
| New web or api misbehaves, **no migration** in the release | Redeploy the previous tags: Dokploy keeps deployments per application, use the **Rollback** action of the compose deployment, or set `API_IMAGE`/`WEB_IMAGE` back to the previous tag and redeploy. Order: web first (it is the part users see; the old web works with the new api), then worker, then api. |
| Misbehaves **after a migration ran** | Same image rollback. The old image runs against the new schema (additive rule) and stays ready (`/readyz` only fails when the database is *behind* the image). **Do not** try to undo the migration. Fix forward in a new release. |
| Only one feature is the problem | Switch it off, do not roll back: `ENABLE_MOCK_MODULES` (unset) hides the mock modules; a tenant's module can be removed from its plan in the console (the web reads entitlements within a minute). |
| Everything is down or a bad deploy must be stopped fast | Put up the **maintenance page** at Cloudflare (a rule or Worker that answers 503 with a static page for the web host; keep `/webhooks/*` passing so Stripe's retries are not lost), then roll back, then remove it. Stripe retries a failed webhook for days; our handlers are idempotent. |
| Data was **wrongly changed or destroyed** (bad migration, bad backfill, bad operator action) | **Point-in-time restore** to a new instance, see below. Only allowed with the product owner's agreement because it discards everything written after the target time. |
| A secret leaked | Not a rollback: rotate (`.claude/docs/deploy/env-matrix.md`) and follow the incident steps in [security-review.md](security-review.md) section 9. |

## Image rollback, step by step

1. Note the failing release tag and the previous good tag (release note).
2. Maintenance page up if users are hitting errors.
3. Dokploy: Compose service, Deployments, pick the previous deployment, **Rollback** (or edit the env tags and redeploy).
4. Wait for `api` `/readyz` and the worker heartbeat; run the smoke test ([runbook-go-live.md](runbook-go-live.md)).
   - **Api and worker go together.** After an api rollout the worker must roll immediately too (the data-request job key `requestId` became `dsrId`: old workers reject new jobs, new workers reject old ones). The pending sweep enqueues the data requests again; a delayed `dsr.export-expire` job of the other image may fail permanently and the stale-request sweep expires that export.
   - **Worker rolled back to an image WITHOUT the roster handlers** (before B8): remove the BullMQ job schedulers the newer worker registered, `queue.removeJobScheduler("roster.auto-repeat")` and `queue.removeJobScheduler("roster.qualification-expiry")` (from a one-off `node` or `tsx` shell on the queue, never by flushing Redis), or accept one failed job per tick (every 15 minutes and every hour) until the roster image is back. Re-rolling the new worker registers them again (`upsertJobScheduler`).
5. Maintenance page down. Open an incident note: what failed, what was rolled back, what the follow-up fix is.
6. The next release must still be a **forward** release: it includes the fix and any new migration, numbered after the existing ones. Never reuse or edit a number that has run.

## Database rollback = restore (last resort)

Allowed only when forward fixing is impossible and the loss window is accepted. It is **point-in-time recovery to a new instance**, never an in-place rewind:

1. Stop writes (scale web, api and worker to zero) and write down the time to restore to (UTC), normally just before the bad migration or operator action. Everything after it is lost (the RPO is up to 1 hour in a disaster; here it is the time you choose).
2. Restore the managed backup to a **new** instance at that timestamp ([backup-restore.md](backup-restore.md)); apply nothing.
3. Verify with the restore drill checks (`deploy/scripts/restore-drill.sh --write-manifest` against the restored instance for the counts you expect, `restore-verify.ts` for the audit chains).
4. Re-point `DATABASE_URL` and `DATABASE_OWNER_URL` (the roles come with the cluster; check `roles.sql` was applied), deploy the **image that matches the restored schema version** (the one from before the bad migration), start api, worker, web.
5. Tell affected clients which period to re-enter. Keep the damaged instance read-only for forensics until the incident closes.

## After any rollback

Re-run the isolation gate and smoke against the running deployment, add the failure to the follow-ups with an owner, and rehearse the rollback again on staging (the go-live checklist requires one rehearsal before the first client).
