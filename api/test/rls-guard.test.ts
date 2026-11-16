import { expect, test } from "vitest"
import { ownerQuery } from "./db"

// Structural RLS guard (single source of truth; replaces the weaker check that lived in db/tenant-tx.test.ts).
// Runs against the fully migrated test database, so every new migration is checked automatically.

test("every table with tenant_id (relkind r or p) has RLS enabled+forced AND a tenant_isolation policy using app.tenant_id", async () => {
  const bad = await ownerQuery(`
    SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r','p') AND c.relnamespace='public'::regnamespace
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation'
          AND p.polpermissive AND p.polcmd='*'
          AND pg_get_expr(p.polqual,p.polrelid) LIKE '%app.tenant_id%'
          AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%app.tenant_id%'))
    ORDER BY c.relname`)
  expect(bad).toEqual([])
})

// Documented exceptions (migration 0005, narrowed by 0010 to "no tenant context"): own-row read paths used to resolve a
// user's memberships/roles before a tenant is chosen. Adding any other policy must be a conscious change to this list.
const ALLOWED_EXTRA = new Set(["memberships.own_memberships_read", "roles.own_membership_role_read"])

test("no policy other than tenant_isolation and the two documented own-row policies exists in public", async () => {
  const rows = await ownerQuery(`
    SELECT c.relname || '.' || p.polname AS name FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relnamespace='public'::regnamespace AND p.polname <> 'tenant_isolation' ORDER BY 1`)
  expect(rows.map((r) => r.name).filter((n) => !ALLOWED_EXTRA.has(String(n)))).toEqual([])
})

test("the documented own-row policies are SELECT-only and only apply without a tenant context", async () => {
  const rows = await ownerQuery(`
    SELECT c.relname || '.' || p.polname AS name, p.polcmd, pg_get_expr(p.polqual,p.polrelid) AS q
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE c.relnamespace='public'::regnamespace AND p.polname <> 'tenant_isolation' ORDER BY 1`)
  expect(rows.map((r) => r.name)).toEqual([...ALLOWED_EXTRA].sort())
  for (const r of rows) {
    expect(r.polcmd).toBe("r")
    expect(String(r.q)).toMatch(/app\.tenant_id.*IS NULL/s)
  }
})

test("no restrictive policies exist", async () => {
  expect(await ownerQuery(`SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND NOT p.polpermissive`)).toEqual([])
})
