import pg from "pg"
import { afterAll, beforeAll, expect, test } from "vitest"

// Structural RLS guard (single source of truth; replaces the weaker check that lived in db/tenant-tx.test.ts).
// Runs against the fully migrated test database, so every new migration is checked automatically.
// Policies are compared for EXACT equality with the canonical deparse (pg_get_expr) of the R8 template, so an inverted
// or "OR true" policy cannot pass. If Postgres changes its deparse, update the constants below deliberately.

const TENANT_EXPR = "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)"

// Documented exceptions (migration 0005, narrowed by 0010 to "no tenant context"): own-row read paths used to resolve a
// user's memberships/roles before a tenant is chosen. Any other policy must be a conscious change to this map.
const OWN_ROW: Record<string, string> = {
  "memberships.own_memberships_read":
    "((user_id = NULLIF(current_setting('app.user_id'::text, true), ''::text)) AND (NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL))",
  "roles.own_membership_role_read":
    "((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) AND (EXISTS ( SELECT 1\n   FROM memberships m\n  WHERE ((m.role_id = roles.id) AND (m.user_id = NULLIF(current_setting('app.user_id'::text, true), ''::text))))))",
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

/** Returns human-readable violations ("table: problem"); empty means the schema is compliant. */
export async function rlsViolations(q: Query): Promise<string[]> {
  const tenantTables = await q(
    `SELECT c.relname,
       c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation' AND p.polpermissive AND p.polcmd='*'
         AND pg_get_expr(p.polqual,p.polrelid) = $1 AND pg_get_expr(p.polwithcheck,p.polrelid) = $1) AS isolated
     FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped
     WHERE c.relkind IN ('r','p') AND c.relnamespace='public'::regnamespace ORDER BY c.relname`,
    [TENANT_EXPR],
  )
  const out: string[] = []
  for (const r of tenantTables.rows) {
    if (!r.enabled) out.push(`${r.relname}: RLS not enabled`)
    if (!r.forced) out.push(`${r.relname}: RLS not forced`)
    if (!r.isolated) out.push(`${r.relname}: no exact permissive FOR ALL tenant_isolation policy`)
  }
  const policies = await q(
    `SELECT c.relname || '.' || p.polname AS name, p.polname, p.polpermissive, p.polcmd,
       pg_get_expr(p.polqual,p.polrelid) AS qual, pg_get_expr(p.polwithcheck,p.polrelid) AS chk
     FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace ORDER BY 1`,
  )
  for (const p of policies.rows) {
    const name = String(p.name)
    if (!p.polpermissive) out.push(`${name}: restrictive policy`)
    if (p.polname === "tenant_isolation") continue // exactness is enforced per tenant table above
    const want = OWN_ROW[name]
    if (want === undefined) out.push(`${name}: unlisted policy`)
    else if (p.polcmd !== "r" || p.qual !== want || p.chk !== null) out.push(`${name}: documented policy changed`)
  }
  return out
}

let client: pg.Client
beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
  await client.connect()
})
afterAll(async () => {
  await client.end()
})
const q: Query = (sql, params) => client.query(sql, params)

test("RLS guard: every tenant_id table is enabled+forced with the exact tenant_isolation policy; only the documented own-row policies exist", async () => {
  expect(await rlsViolations(q)).toEqual([])
})

test("pinned own-row policies are exactly the two documented ones", async () => {
  const names = (await q(`SELECT c.relname || '.' || p.polname AS n FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE p.polname <> 'tenant_isolation' ORDER BY 1`)).rows.map((r) => r.n)
  expect(names).toEqual(Object.keys(OWN_ROW).sort())
})

// Meta-test: the same rlsViolations code must flag each deliberately broken table (all rolled back).
const GOOD = `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const cases: { name: string; setup: string[]; expectTable: string }[] = [
  { name: "no RLS", setup: [`CREATE TABLE zz_bad (tenant_id uuid)`], expectTable: "zz_bad: RLS not enabled" },
  {
    name: "RLS enabled but not forced",
    setup: [`CREATE TABLE zz_bad (tenant_id uuid)`, `ALTER TABLE zz_bad ENABLE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation ON zz_bad USING (${GOOD}) WITH CHECK (${GOOD})`],
    expectTable: "zz_bad: RLS not forced",
  },
  { name: "inverted <> qual", setup: bad(`tenant_id <> nullif(current_setting('app.tenant_id', true), '')::uuid`, GOOD), expectTable: "zz_bad: no exact" },
  { name: "OR true qual and check", setup: bad(`${GOOD} OR true`, `true OR ${GOOD}`), expectTable: "zz_bad: no exact" },
  {
    name: "policy FOR INSERT only",
    setup: [`CREATE TABLE zz_bad (tenant_id uuid)`, `ALTER TABLE zz_bad ENABLE ROW LEVEL SECURITY`, `ALTER TABLE zz_bad FORCE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation ON zz_bad FOR INSERT WITH CHECK (${GOOD})`],
    expectTable: "zz_bad: no exact",
  },
  {
    name: "a RESTRICTIVE policy",
    setup: [...bad(GOOD, GOOD), `CREATE POLICY zz_r ON zz_bad AS RESTRICTIVE USING (true)`],
    expectTable: "zz_bad.zz_r: restrictive policy",
  },
  { name: "extra unlisted permissive policy on a good table", setup: [...bad(GOOD, GOOD), `CREATE POLICY zz_open ON zz_bad FOR SELECT USING (true)`], expectTable: "zz_bad.zz_open: unlisted policy" },
]
function bad(using: string, check: string): string[] {
  return [
    `CREATE TABLE zz_bad (tenant_id uuid)`,
    `ALTER TABLE zz_bad ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zz_bad FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zz_bad USING (${using}) WITH CHECK (${check})`,
  ]
}
test.each(cases)("meta: guard reports $name", async ({ setup, expectTable }) => {
  await client.query("BEGIN")
  try {
    for (const s of setup) await client.query(s)
    const v = await rlsViolations(q)
    expect(v.some((x) => x.startsWith(expectTable))).toBe(true)
  } finally {
    await client.query("ROLLBACK")
  }
  expect(await rlsViolations(q)).toEqual([]) // rolled back: schema is clean again
})
test("meta: a perfectly good table is not reported", async () => {
  await client.query("BEGIN")
  try {
    for (const s of bad(GOOD, GOOD)) await client.query(s)
    expect(await rlsViolations(q)).toEqual([])
  } finally {
    await client.query("ROLLBACK")
  }
})
