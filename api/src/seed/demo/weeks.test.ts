import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { fakeClock } from "../../../test/fakes"
import { demoOptions, PUBLIC_DATA } from "../../../test/seed-support"
import { weekOffset } from "./anchor"
import { seedDemo } from "./seed"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const read = <T = Json>(path: string): T => JSON.parse(readFileSync(join(PUBLIC_DATA, path), "utf8")) as T
const reports = read<{ reports: Json[] }>("reports/reports.json").reports
const assignments = read<{ assignments: Json[] }>("shifts/assignments.json").assignments
const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000

describe("weekday semantics survive any anchor (J6)", () => {
  test("weekOffset is a whole number of weeks and never puts the latest report after the anchor", () => {
    for (let k = 0; k < 14; k++) {
      const anchor = new Date(Date.parse("2026-12-01T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10)
      const w = weekOffset({ mockToday: "2026-10-20T09:00:00", anchor, latestMockDay: "2026-10-19" })
      expect(w % 7).toBe(0)
      expect(day("2026-10-19") + w).toBeLessThanOrEqual(day(anchor))
      expect(day(anchor) - (day("2026-10-19") + w)).toBeLessThan(7)
    }
  })

  beforeAll(resetDb)

  test("for each day of a week as the anchor: every report's shift date is a day its pattern runs, at the pattern's local time; assignments move by whole weeks; no duplicates on re-runs", async () => {
    const all: string[] = []
    for (let k = 0; k < 7; k++) {
      const anchor = new Date(Date.parse("2026-12-01T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10)
      const report = await seedDemo(testDb(), await demoOptions({ anchor, clock: fakeClock(new Date(`${anchor}T12:00:00Z`)) }))
      const tenant = String((await ownerQuery("select id from tenants where slug = 'northgate'"))[0].id)
      const bad = await ownerTenantQuery(
        tenant,
        `select r.shift_date::text as d from shift_reports r join shift_patterns p on p.id = r.pattern_id
         where not (extract(dow from r.shift_date)::int = any(p.days))
            or to_char(r.start_at at time zone coalesce(p.time_zone, 'Europe/Dublin'), 'HH24:MI') <> p.start_time
            or r.shift_date > date '${anchor}'`,
      )
      expect(bad, `anchor ${anchor}`).toEqual([])
      expect(Number((await ownerTenantQuery(tenant, "select count(*)::int as n from shift_reports"))[0].n)).toBe(reports.length)
      const dates = (await ownerTenantQuery(tenant, "select to_char(shift_date,'YYYY-MM-DD') as d from shift_reports order by 1")).map((r) => String(r.d))
      const shift = day(dates[dates.length - 1]) - Math.max(...reports.map((r) => day(r.date)))
      expect(shift % 7).toBe(0)
      const asg = (await ownerTenantQuery(tenant, "select to_char(from_date,'YYYY-MM-DD') as f from shift_assignments order by 1")).map((r) => day(String(r.f)))
      expect(asg).toEqual(assignments.map((a) => day(a.from) + shift).sort((a, b) => a - b))
      const exact = day(anchor) - day("2026-10-20")
      if (shift !== exact) expect(report.warnings.some((w) => /shift dates moved by/.test(w))).toBe(true)
      else expect(report.warnings.some((w) => /shift dates moved by/.test(w))).toBe(false)
      all.push(`${anchor}:${shift}`)
    }
    expect(Number((await ownerQuery("select count(*)::int as n from tenants"))[0].n)).toBe(3)
    expect(Number((await ownerQuery('select count(*)::int as n from "user"'))[0].n)).toBe(22)
    expect(new Set(all).size).toBeGreaterThan(1)
  }, 300_000)
})
