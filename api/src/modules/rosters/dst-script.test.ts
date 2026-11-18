import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, expect, test } from "vitest"

// R8-1 stored-data check script: a shift report is read in its PATTERN's zone (when set), a task in the tenant zone.
const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 1 })
afterAll(() => owner.end())
const script = readFileSync(new URL("../../../scripts/dst-gap-night-check.sql", import.meta.url), "utf8")

test("dst-gap-night-check.sql flags a report on the pattern zone's change day, not the tenant zone's (coalesce(pattern zone, tenant zone))", async () => {
  const c = await owner.connect()
  try {
    await c.query("begin")
    const tenant = randomUUID()
    await c.query("insert into tenants (id, slug, name, timezone) values ($1, $2, 'T', 'Europe/Dublin')", [tenant, `d-${tenant.slice(0, 8)}`])
    await c.query("select set_config('app.tenant_id', $1, true)", [tenant])
    const team = randomUUID()
    await c.query("insert into teams (id, tenant_id, name) values ($1, $2, 'Ops')", [team, tenant])
    const pat = async (zone: string | null) => {
      const id = randomUUID()
      await c.query("insert into shift_patterns (id, tenant_id, team_id, name, start_time, end_time, days, time_zone, created_at, updated_at) values ($1, $2, $3, 'N' || $1::uuid::text, '01:30', '09:30', '{0,1,2,3,4,5,6}', $4, now(), now())", [id, tenant, team, zone])
      return id
    }
    const report = async (patternId: string, date: string) => {
      const id = randomUUID()
      await c.query("insert into shift_reports (id, tenant_id, pattern_id, shift_date, team_id, shift_name, start_at, end_at, due_at, created_at, updated_at) values ($1, $2, $3, $4, $5, 'N', $6, $7, $8, now(), now())", [id, tenant, patternId, date, team, `${date}T15:00Z`, `${date}T16:00Z`, `${date}T17:00Z`])
      return id
    }
    const ny = await report(await pat("America/New_York"), "2027-03-14") // New York springs forward on 14 Mar 2027; Dublin does not until 28 Mar
    const dub = await report(await pat(null), "2027-03-14") // tenant zone Dublin: an ordinary day
    const ids = (await c.query(script)).rows.map((r) => r.id)
    expect(ids).toContain(ny)
    expect(ids).not.toContain(dub)
  } finally {
    await c.query("rollback")
    c.release()
  }
})
