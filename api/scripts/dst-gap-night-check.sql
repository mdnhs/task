-- R8-1 stored-data check (read-only). Lists shift_reports and tasks whose stored start/end/due instant falls on a DST change day of the tenant's zone.
-- Only those could have been produced from a wall time inside a spring-forward gap, so only those can differ from the new rule (up to the gap length).
-- Nothing is recomputed or rewritten: stored instants stay as they are. Run as app_owner (it bypasses RLS) against a restored copy or production:
--   psql "$OWNER_DATABASE_URL" -f api/scripts/dst-gap-night-check.sql
WITH t AS (SELECT id, timezone AS tz FROM tenants),
c AS (
  SELECT 'shift_reports' AS tbl, r.tenant_id, r.id, x.at, t.tz FROM shift_reports r JOIN t ON t.id = r.tenant_id, LATERAL (VALUES (r.start_at), (r.end_at), (r.due_at)) x(at)
  UNION ALL
  SELECT 'tasks', k.tenant_id, k.id, x.at, t.tz FROM tasks k JOIN t ON t.id = k.tenant_id, LATERAL (VALUES (k.start_at), (k.due_at)) x(at)
)
SELECT tbl, tenant_id, id, at, tz
FROM c
WHERE (((at + interval '1 day') AT TIME ZONE tz) - ((at + interval '1 day') AT TIME ZONE 'UTC'))
   <> (((at - interval '1 day') AT TIME ZONE tz) - ((at - interval '1 day') AT TIME ZONE 'UTC'))
ORDER BY tbl, at;
