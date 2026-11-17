import { sql } from "drizzle-orm"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { withTenant } from "../../db/tenant-tx"
import { clearModuleOverride } from "../entitlements"
import { WEBHOOK_EVENT_TYPES } from "../webhooks-out"
import { assignmentsInWindowQuery, livePatternsQuery, occurrencesBetween, effectiveReporting } from "."
import { reportDueAfterMinutes } from "../settings"

// T5.1: shift patterns, assignments, reporting settings, the occurrence engine. Rulings F2, F3, F13, F14 (and E2 for the team-scope manager).

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string; cookie: string }

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})
afterEach(resetSubscribers)

async function world(over: { timezone?: string; slug?: string } = {}) {
  const t = testApp()
  const slug = over.slug ?? "acme"
  const tenant = await makeTenant(t.deps, { slug })
  await ownerQuery("update tenants set timezone = $1 where id = $2", [over.timezone ?? "Europe/Dublin", tenant.id])
  const who = async (role: string): Promise<Who> => {
    const m = await makeMember(t.deps, tenant.id, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(t.app, m.email, m.password)).cookie }
  }
  const owner = await who("owner")
  const manager = await who("manager") // manager-home, reportScope "team"
  const ops = await who("ops") // manager-home, all
  const staff = await who("employee")
  const staff2 = await who("employee")
  const staff3 = await who("employee")
  const req = (method: string, path: string, as: { cookie: string } | null, body?: unknown) => call(t.app, method, path, { cookie: as?.cookie, tenant: slug, body })
  const json = async (r: Response) => (await r.json()) as Json
  const q = <R = Json>(sqlText: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sqlText, params) as Promise<R[]>
  const team = async (name: string, memberIds: string[] = []) => {
    const r = await req("POST", "/v1/teams", owner, { name, kind: "team" })
    expect(r.status).toBe(201)
    const tm = await json(r)
    if (memberIds.length) expect((await req("PUT", `/v1/teams/${tm.id}/members`, owner, { userIds: memberIds })).status).toBe(200)
    return tm.id as string
  }
  const manages = async (mgr: Who, person: Who) => expect((await req("PUT", `/v1/members/${person.userId}/manager`, owner, { managerId: mgr.userId })).status).toBe(200)
  const pattern = async (as: Who, teamId: string, o: Json = {}) => {
    const r = await req("POST", "/v1/shifts/patterns", as, { name: "Night", teamId, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6], ...o })
    expect(r.status, await r.clone().text()).toBe(201)
    return json(r)
  }
  const assign = async (as: Who, userId: string, patternId: string, from = "2026-10-01", o: Json = {}) => {
    const r = await req("POST", "/v1/shifts/assignments", as, { userId, patternId, from, ...o })
    expect(r.status, await r.clone().text()).toBe(201)
    return json(r)
  }
  const occ = async (as: Who, from: string, to: string, extra = "") => {
    const r = await req("GET", `/v1/shifts/occurrences?from=${from}&to=${to}${extra}`, as)
    expect(r.status, await r.clone().text()).toBe(200)
    return (await json(r)).items as Json[]
  }
  return { ...t, tenant, slug, who, owner, manager, ops, staff, staff2, staff3, req, json, q, team, manages, pattern, assign, occ }
}
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string

describe("occurrence engine across both DST changes", () => {
  test("Europe/Dublin 22:00-06:00: Sat 24 Oct 2026 is 9 h and belongs to the 24th, Sun 25 Oct is 8 h, Sat 27 Mar 2027 is 7 h", async () => {
    const w = await world()
    const A = await w.team("Night team")
    const p = await w.pattern(w.ops, A)
    await w.assign(w.ops, w.staff.userId, p.id)
    const oct = await w.occ(w.ops, "2026-10-24", "2026-10-25")
    expect(oct.map((o) => [o.shiftDate, o.startAt, o.endAt, o.minutes, o.start, o.end, o.endsNextDay])).toEqual([
      ["2026-10-24", "2026-10-24T21:00:00.000Z", "2026-10-25T06:00:00.000Z", 540, "2026-10-24T22:00", "2026-10-25T06:00", true],
      ["2026-10-25", "2026-10-25T22:00:00.000Z", "2026-10-26T06:00:00.000Z", 480, "2026-10-25T22:00", "2026-10-26T06:00", true],
    ])
    const mar = await w.occ(w.ops, "2027-03-27", "2027-03-28")
    expect(mar.map((o) => [o.shiftDate, o.startAt, o.endAt, o.minutes, o.end])).toEqual([
      ["2027-03-27", "2027-03-27T22:00:00.000Z", "2027-03-28T05:00:00.000Z", 420, "2027-03-28T06:00"],
      ["2027-03-28", "2027-03-28T21:00:00.000Z", "2027-03-29T05:00:00.000Z", 480, "2027-03-29T06:00"],
    ])
  })

  test("an end time inside the repeated hour takes the earlier instant; a start inside the spring-forward gap moves forward", async () => {
    const w = await world()
    const A = await w.team("A")
    const late = await w.pattern(w.ops, A, { name: "Late", start: "18:00", end: "01:30" })
    const early = await w.pattern(w.ops, A, { name: "Early", start: "01:30", end: "09:30" })
    await w.assign(w.ops, w.staff.userId, late.id)
    await w.assign(w.ops, w.staff2.userId, early.id)
    const [l] = await w.occ(w.ops, "2026-10-24", "2026-10-24", `&userId=${w.staff.userId}`)
    expect([l.startAt, l.endAt, l.minutes]).toEqual(["2026-10-24T17:00:00.000Z", "2026-10-25T00:30:00.000Z", 450]) // 01:30 BST, the first of the two
    const [e] = await w.occ(w.ops, "2027-03-28", "2027-03-28", `&userId=${w.staff2.userId}`)
    expect([e.startAt, e.endAt, e.minutes, e.start]).toEqual(["2027-03-28T01:30:00.000Z", "2027-03-28T08:30:00.000Z", 420, "2027-03-28T02:30"])
  })

  test("a pattern in Pacific/Auckland keeps its own start date; a tenant in Auckland gets the same real durations", async () => {
    const w = await world({ timezone: "Pacific/Auckland" })
    const A = await w.team("A")
    const night = await w.pattern(w.ops, A)
    const dub = await w.pattern(w.ops, A, { name: "Dublin early", start: "06:00", end: "14:00", days: [1], timeZone: "Europe/Dublin" })
    await w.assign(w.ops, w.staff.userId, night.id, "2026-09-01")
    await w.assign(w.ops, w.staff2.userId, dub.id, "2026-09-01")
    // Auckland clocks go forward 2:00 -> 3:00 on Sun 27 Sep 2026 and back 3:00 -> 2:00 on Sun 4 Apr 2027
    const mins = async (from: string, to: string) => (await w.occ(w.ops, from, to, `&userId=${w.staff.userId}`)).map((o) => [o.shiftDate, o.minutes])
    expect(await mins("2026-09-26", "2026-09-27")).toEqual([["2026-09-26", 420], ["2026-09-27", 480]])
    expect(await mins("2027-04-03", "2027-04-05")).toEqual([["2027-04-03", 540], ["2027-04-04", 480], ["2027-04-05", 480]])
    // Mon 19 Oct 2026 06:00 in Dublin (BST) = 05:00Z = 18:00 Auckland (NZDT): the shift is a MONDAY shift (its own zone), whatever the tenant clock reads
    const [d] = await w.occ(w.ops, "2026-10-19", "2026-10-19", `&userId=${w.staff2.userId}`)
    expect([d.shiftDate, d.startAt, d.start, d.minutes]).toEqual(["2026-10-19", "2026-10-19T05:00:00.000Z", "2026-10-19T18:00", 480])
  })

  test("occurrencesBetween honours days, from/until inclusive, archived patterns and a member on two teams (reporting read with the shift's team)", async () => {
    const w = await world()
    const A = await w.team("Alpha", [w.staff.userId])
    const B = await w.team("Bravo", [w.staff.userId]) // staff is on BOTH teams
    const weekdays = await w.pattern(w.ops, A, { name: "Weekdays", start: "07:00", end: "15:00", days: [1, 2, 3, 4, 5] })
    const evening = await w.pattern(w.ops, B, { name: "Evening", start: "17:00", end: "23:00", days: [1, 3] })
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: true })).status).toBe(200)
    // from/until are inclusive: Mon 19 Oct .. Wed 21 Oct
    await w.assign(w.ops, w.staff.userId, weekdays.id, "2026-10-19", { until: "2026-10-21" })
    await w.assign(w.ops, w.staff.userId, evening.id, "2026-10-01")
    const week = await w.occ(w.ops, "2026-10-19", "2026-10-25", `&userId=${w.staff.userId}`)
    expect(week.map((o) => `${o.shiftDate} ${o.name} ${o.reportsOn}`)).toEqual([
      "2026-10-19 Weekdays true", "2026-10-19 Evening false", "2026-10-20 Weekdays true", "2026-10-21 Weekdays true", "2026-10-21 Evening false",
    ]) // Thu/Fri are past `until`; Evening only runs Mon/Wed; team Bravo has no default so its shift is off, Alpha's is on
    // an archived pattern produces nothing, but its assignment row stays
    expect((await w.req("DELETE", `/v1/shifts/patterns/${evening.id}`, w.ops)).status).toBe(204)
    expect((await w.occ(w.ops, "2026-10-19", "2026-10-25")).map((o) => o.name)).toEqual(["Weekdays", "Weekdays", "Weekdays"])
    expect((await w.q("select count(*)::int n from shift_assignments where pattern_id = $1", [evening.id]))[0].n).toBe(1)
    // the engine function itself (the reports module and the recurrence job call it)
    const got = await withTenant(w.deps.db, w.tenant.id, (tx) => occurrencesBetween(tx, w.tenant.id, "Europe/Dublin", "2026-10-19", "2026-10-19"))
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ userId: w.staff.userId, patternId: weekdays.id, teamId: A, shiftDate: "2026-10-19" })
    expect(got[0].startAt.toISOString()).toBe("2026-10-19T06:00:00.000Z") // 07:00 IST (UTC+1 until 25 Oct)
  })

  test("a suspended member produces no occurrences", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    await w.assign(w.ops, w.staff.userId, p.id)
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff.userId])
    expect(await w.occ(w.ops, "2026-10-24", "2026-10-25")).toEqual([])
  })
})

describe("reporting on/off: override ?? team default ?? off", () => {
  test("the member's override beats the team default; null follows the team; a team change moves only members without an override", async () => {
    const w = await world()
    const A = await w.team("A", [w.staff.userId, w.staff2.userId, w.staff3.userId])
    const p = await w.pattern(w.ops, A, { name: "Day", start: "07:00", end: "15:00" })
    for (const u of [w.staff, w.staff2, w.staff3]) await w.assign(w.ops, u.userId, p.id)
    const on = async () => (await w.occ(w.ops, "2026-10-20", "2026-10-20")).filter((o) => o.reportsOn).map((o) => o.userId).sort()
    const all = [w.staff.userId, w.staff2.userId, w.staff3.userId].sort()
    expect(await on()).toEqual([]) // no row anywhere = off
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: true })).status).toBe(200)
    expect(await on()).toEqual(all)
    // override OFF for staff2 beats the team default ON
    expect(await w.json(await w.req("PUT", `/v1/shifts/reporting/people/${w.staff2.userId}`, w.ops, { on: false }))).toEqual({ userId: w.staff2.userId, on: false })
    expect(await on()).toEqual([w.staff.userId, w.staff3.userId].sort())
    // a team change: default OFF turns off the members that follow it, staff2's override still says off, and an override ON for staff3 survives
    await w.req("PUT", `/v1/shifts/reporting/people/${w.staff3.userId}`, w.ops, { on: true })
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: false })).status).toBe(200)
    expect(await on()).toEqual([w.staff3.userId])
    // null clears the override: the member follows the team (now off) again
    expect(await w.json(await w.req("PUT", `/v1/shifts/reporting/people/${w.staff3.userId}`, w.ops, { on: null }))).toEqual({ userId: w.staff3.userId, on: null })
    expect(await on()).toEqual([])
    expect((await w.q("select count(*)::int n from shift_reporting_people where user_id = $1", [w.staff3.userId]))[0].n).toBe(0)
    // effectiveReporting (the reports module and the deadline job) reads the same precedence
    const eff = (u: string) => withTenant(w.deps.db, w.tenant.id, (tx) => effectiveReporting(tx, w.tenant.id, u, A))
    expect([await eff(w.staff.userId), await eff(w.staff2.userId), await eff(w.staff3.userId)]).toEqual([false, false, false])
    await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: true })
    expect([await eff(w.staff.userId), await eff(w.staff2.userId), await eff(w.staff3.userId)]).toEqual([true, false, true])
  })

  test("AC-M1-01: reporting on for 3 of 5 members gives 3 reporting occurrences", async () => {
    const w = await world()
    const extra = [await w.who("employee"), await w.who("employee")]
    const five = [w.staff, w.staff2, w.staff3, ...extra]
    const A = await w.team("A", five.map((m) => m.userId))
    const p = await w.pattern(w.ops, A, { name: "Day", start: "07:00", end: "15:00" })
    for (const m of five) await w.assign(w.ops, m.userId, p.id)
    for (const m of five.slice(0, 3)) expect((await w.req("PUT", `/v1/shifts/reporting/people/${m.userId}`, w.ops, { on: true })).status).toBe(200)
    const items = await w.occ(w.ops, "2026-10-20", "2026-10-20")
    expect(items).toHaveLength(5)
    expect(items.filter((o) => o.reportsOn)).toHaveLength(3)
  })

  test("reportDueAfterMinutes: the default comes from the onboarding data file, PATCH validates 0..1440 and is audited", async () => {
    const w = await world()
    const data = JSON.parse((await import("node:fs")).readFileSync(new URL("../../../../public/data/auth/onboarding-defaults.json", import.meta.url), "utf8")) as { reportDueAfterMinutes: number }
    expect(data.reportDueAfterMinutes).toBe(60)
    expect((await w.json(await w.req("GET", "/v1/settings/organisation", w.owner))).reportDueAfterMinutes).toBe(data.reportDueAfterMinutes)
    expect((await w.json(await w.req("GET", "/v1/shifts", w.ops))).reporting.dueAfterMinutes).toBe(data.reportDueAfterMinutes)
    for (const v of [-1, 1441, 1.5, 60.0001]) {
      const r = await w.req("PATCH", "/v1/settings/organisation", w.owner, { reportDueAfterMinutes: v })
      expect([v, r.status, await code(r)]).toEqual([v, 422, "invalid_report_due"])
    }
    expect((await w.req("PATCH", "/v1/settings/organisation", w.owner, { reportDueAfterMinutes: "60" })).status).toBe(400) // not a number
    for (const v of [0, 1440, 90]) {
      const r = await w.req("PATCH", "/v1/settings/organisation", w.owner, { reportDueAfterMinutes: v })
      expect([v, r.status]).toEqual([v, 200])
      expect((await w.json(r)).reportDueAfterMinutes).toBe(v)
    }
    expect(await withTenant(w.deps.db, w.tenant.id, (tx) => reportDueAfterMinutes(tx, w.tenant.id))).toBe(90)
    expect((await w.json(await w.req("GET", "/v1/shifts", w.owner))).reporting.dueAfterMinutes).toBe(90)
    const audits = await w.q("select actor_id, before, after from audit_events where action = 'tenant.settings_updated' order by seq")
    expect(audits.at(-1)).toMatchObject({ before: { reportDueAfterMinutes: 1440 }, after: { reportDueAfterMinutes: 90 } })
    expect(audits).toHaveLength(3) // 0, 1440, 90 (the refused ones wrote nothing)
    expect((await w.req("PATCH", "/v1/settings/organisation", w.manager, { reportDueAfterMinutes: 30 })).status).toBe(403) // settings:read only
  })
})

describe("patterns", () => {
  test("create validates name, HH:MM, weekdays and the IANA zone; a name is unique per team among live patterns", async () => {
    const w = await world()
    const A = await w.team("A")
    const B = await w.team("B")
    const post = (o: Json) => w.req("POST", "/v1/shifts/patterns", w.ops, { name: "Night", teamId: A, start: "22:00", end: "06:00", days: [1, 2], ...o })
    for (const [o, c] of [
      [{ name: "  " }, "invalid_pattern"], [{ name: "x".repeat(81) }, "invalid_pattern"], [{ name: "a\nb" }, "invalid_pattern"], [{ start: "24:00" }, "invalid_pattern"], [{ end: "6:00" }, "invalid_pattern"],
      [{ days: [] }, "invalid_pattern"], [{ days: [1, 1] }, "invalid_pattern"], [{ days: [7] }, "invalid_pattern"], [{ days: [0, 1, 2, 3, 4, 5, 6, 0] }, "invalid_pattern"],
      [{ timeZone: "Mars/Base" }, "invalid_pattern_zone"], [{ timeZone: "+01:00" }, "invalid_pattern_zone"], [{ timeZone: "" }, "invalid_pattern_zone"],
    ] as [Json, string][]) {
      const r = await post(o)
      expect([JSON.stringify(o), r.status, await code(r)]).toEqual([JSON.stringify(o), 422, c])
    }
    expect((await post({ teamId: "not-a-uuid" })).status).toBe(400)
    const ok = await post({ name: "  Night  ", days: [5, 1, 3], timeZone: "europe/dublin" })
    expect(ok.status).toBe(201)
    expect(await w.json(ok)).toMatchObject({ name: "Night", days: [1, 3, 5], timeZone: "Europe/Dublin", version: 1, teamId: A, start: "22:00", end: "06:00" })
    const dup = await post({ name: "Night" })
    expect([dup.status, await code(dup)]).toEqual([409, "pattern_name_taken"])
    expect((await post({ name: "Night", teamId: B })).status).toBe(201) // same name, another team
    expect(await code(await post({ teamId: "00000000-0000-4000-8000-000000000000" }))).toBe("team_not_found")
  })

  test("PATCH is versioned: a stale version is 409 version_conflict, two concurrent edits of one version give one 200 and one 409", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const stale = await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 9, end: "07:00" })
    expect([stale.status, await code(stale)]).toEqual([409, "version_conflict"])
    const done = await w.json(await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 1, end: "07:00", timeZone: "Europe/London" }))
    expect(done).toMatchObject({ version: 2, end: "07:00", timeZone: "Europe/London" })
    expect((await w.json(await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 2, timeZone: null }))).timeZone).toBeNull() // null clears the zone
    const noop = await w.json(await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 3, end: "07:00" }))
    expect(noop.version).toBe(3) // nothing changed: no bump
    const rs = await Promise.all([1, 2, 3, 4].map((i) => w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 3, name: `N${i}` })))
    const statuses = rs.map((r) => r.status).sort()
    expect(statuses).toEqual([200, 409, 409, 409])
    for (const r of rs) if (r.status === 409) expect(await code(r)).toBe("version_conflict")
    expect((await w.q("select version from shift_patterns where id = $1", [p.id]))[0].version).toBe(4)
    expect((await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 4 })).status).toBe(400) // nothing to change
  })

  test("DELETE archives (F14): the pattern leaves the list and PATCH/DELETE become 404, its assignments keep their rows and give no shifts, and no new assignment is accepted", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const a = await w.assign(w.ops, w.staff.userId, p.id)
    expect((await w.json(await w.req("GET", "/v1/shifts", w.ops))).patterns.map((x: Json) => x.id)).toEqual([p.id])
    expect((await w.req("DELETE", `/v1/shifts/patterns/${p.id}`, w.ops)).status).toBe(204)
    const row = (await w.q("select archived_at, version from shift_patterns where id = $1", [p.id]))[0]
    expect(row.archived_at).not.toBeNull()
    expect(row.version).toBe(2)
    const list = await w.json(await w.req("GET", "/v1/shifts", w.ops))
    expect(list.patterns).toEqual([])
    expect(list.assignments).toEqual([])
    expect((await w.q("select id from shift_assignments")).map((r) => r.id)).toEqual([a.id])
    expect(await w.occ(w.ops, "2026-10-24", "2026-10-25")).toEqual([])
    for (const [m, path, b] of [["PATCH", `/v1/shifts/patterns/${p.id}`, { version: 2, name: "x" }], ["DELETE", `/v1/shifts/patterns/${p.id}`, undefined]] as [string, string, unknown][]) {
      const r = await w.req(m, path, w.ops, b)
      expect([r.status, await code(r)]).toEqual([404, "shift_pattern_not_found"])
    }
    const again = await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: w.staff2.userId, patternId: p.id, from: "2026-10-01" })
    expect([again.status, await code(again)]).toEqual([422, "invalid_assignment"])
    expect((await w.req("PATCH", `/v1/shifts/assignments/${a.id}`, w.ops, { until: "2026-10-31" })).status).toBe(200) // an open assignment of an archived pattern can still be ended
    expect(await w.q("select name from shift_patterns where tenant_id = $1 and archived_at is null", [w.tenant.id])).toEqual([])
    // the name is free again for a new live pattern
    expect((await w.req("POST", "/v1/shifts/patterns", w.ops, { name: "Night", teamId: A, start: "22:00", end: "06:00", days: [1] })).status).toBe(201)
  })

  test("deleting a team that has patterns (archived too) is 409 team_has_shifts; one without is deleted", async () => {
    const w = await world()
    const A = await w.team("A")
    const B = await w.team("B")
    const p = await w.pattern(w.ops, A)
    const r = await w.req("DELETE", `/v1/teams/${A}`, w.owner)
    expect([r.status, await code(r)]).toEqual([409, "team_has_shifts"])
    await w.req("DELETE", `/v1/shifts/patterns/${p.id}`, w.ops)
    expect(await code(await w.req("DELETE", `/v1/teams/${A}`, w.owner))).toBe("team_has_shifts") // reports keep pointing at an archived pattern
    expect((await w.req("DELETE", `/v1/teams/${B}`, w.owner)).status).toBe(204)
    await w.req("PUT", `/v1/shifts/reporting/teams/${B}`, w.ops, { on: true }).catch(() => undefined)
  })

  test("a pattern create racing a team delete: either the team is deleted and the pattern is 404 team_not_found, or the pattern exists and the delete is 409 team_has_shifts", async () => {
    for (let i = 0; i < 6; i++) {
      await resetDb()
      const w = await world()
      const A = await w.team("A")
      const [mk, del] = await Promise.all([w.req("POST", "/v1/shifts/patterns", w.ops, { name: "N", teamId: A, start: "22:00", end: "06:00", days: [1] }), w.req("DELETE", `/v1/teams/${A}`, w.owner)])
      const patterns = (await w.q("select count(*)::int n from shift_patterns"))[0].n
      const teams = (await w.q("select count(*)::int n from teams where id = $1", [A]))[0].n
      if (mk.status === 201) expect([del.status, patterns, teams]).toEqual([409, 1, 1])
      else expect([mk.status, await code(mk), del.status, patterns, teams]).toEqual([404, "team_not_found", 204, 0, 0])
    }
  }, 120_000)
})

describe("assignments", () => {
  test("the assignee must be an ACTIVE member whose role can read reports or tasks (422 invalid_assignment); bad dates and unknown users too", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const hr = await w.who("hr")
    await w.q(`update roles set access = access || '{"tasks":"none","reports":"none"}'::jsonb where key = 'hr'`)
    const post = (b: Json) => w.req("POST", "/v1/shifts/assignments", w.ops, { patternId: p.id, from: "2026-10-01", userId: w.staff.userId, ...b })
    for (const [b, why] of [
      [{ userId: hr.userId }, "no reports or tasks access"], [{ userId: "usr_ghost" }, "not a member"], [{ from: "2026-02-30" }, "bad date"], [{ from: "2026-10-05", until: "2026-10-04" }, "until before from"], [{ until: "x" }, "bad until"],
    ] as [Json, string][]) {
      const r = await post(b)
      expect([why, r.status, await code(r)]).toEqual([why, 422, "invalid_assignment"])
    }
    await w.q("update memberships set status = 'suspended' where user_id = $1", [w.staff2.userId])
    expect(await code(await post({ userId: w.staff2.userId }))).toBe("invalid_assignment")
    expect(await code(await post({ patternId: "00000000-0000-4000-8000-000000000000" }))).toBe("shift_pattern_not_found")
    const ok = await post({ until: "2026-10-31" })
    expect(ok.status).toBe(201)
    expect(await w.json(ok)).toMatchObject({ userId: w.staff.userId, patternId: p.id, from: "2026-10-01", until: "2026-10-31" })
    expect((await w.q("select created_by from shift_assignments"))[0].created_by).toBe(w.ops.userId)
  })

  test("an overlap for the same member and pattern is 422 invalid_assignment (also from a PATCH), another pattern or member is fine, and 10 concurrent POSTs let exactly one win", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const p2 = await w.pattern(w.ops, A, { name: "Day", start: "07:00", end: "15:00" })
    const first = await w.assign(w.ops, w.staff.userId, p.id, "2026-10-01", { until: "2026-10-31" })
    const post = (b: Json) => w.req("POST", "/v1/shifts/assignments", w.ops, { userId: w.staff.userId, patternId: p.id, from: "2026-11-01", ...b })
    expect((await post({ from: "2026-10-31" })).status).toBe(422) // the last day is inclusive
    expect((await post({ from: "2026-09-01", until: "2026-10-01" })).status).toBe(422) // the first day is inclusive
    expect((await post({ from: "2026-09-01" })).status).toBe(422) // open-ended reaches into it
    expect((await post({ from: "2026-11-01" })).status).toBe(201) // adjacent is fine
    const patch = await w.req("PATCH", `/v1/shifts/assignments/${first.id}`, w.ops, { until: null }) // re-opening would run into the November one
    expect([patch.status, await code(patch)]).toEqual([422, "invalid_assignment"])
    expect((await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: w.staff.userId, patternId: p2.id, from: "2026-10-01" })).status).toBe(201)
    expect((await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: w.staff2.userId, patternId: p.id, from: "2026-10-01" })).status).toBe(201)
    const rs = await Promise.all(Array.from({ length: 10 }, () => w.req("POST", "/v1/shifts/assignments", w.ops, { userId: w.staff3.userId, patternId: p.id, from: "2027-01-01", until: "2027-01-31" })))
    expect(rs.map((r) => r.status).sort()).toEqual([201, 422, 422, 422, 422, 422, 422, 422, 422, 422])
    expect((await w.q("select count(*)::int n from shift_assignments where user_id = $1", [w.staff3.userId]))[0].n).toBe(1)
  }, 60_000)

  test("DELETE of a started assignment is 409 assignment_started, a future one is deleted; PATCH until keeps the history", async () => {
    const w = await world() // fake clock: Mon 16 Nov 2026 09:00Z
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const started = await w.assign(w.ops, w.staff.userId, p.id, "2026-11-10")
    const today = await w.assign(w.ops, w.staff2.userId, p.id, "2026-11-16")
    const future = await w.assign(w.ops, w.staff3.userId, p.id, "2026-11-17")
    for (const a of [started, today]) {
      const r = await w.req("DELETE", `/v1/shifts/assignments/${a.id}`, w.ops)
      expect([r.status, await code(r)]).toEqual([409, "assignment_started"])
    }
    expect((await w.req("DELETE", `/v1/shifts/assignments/${future.id}`, w.ops)).status).toBe(204)
    const ended = await w.json(await w.req("PATCH", `/v1/shifts/assignments/${started.id}`, w.ops, { until: "2026-11-15" }))
    expect(ended).toMatchObject({ id: started.id, from: "2026-11-10", until: "2026-11-15" })
    expect((await w.q("select id from shift_assignments order by id")).map((r) => r.id).sort()).toEqual([started.id, today.id].sort())
    const bad = await w.req("PATCH", `/v1/shifts/assignments/${started.id}`, w.ops, { until: "2026-11-09" }) // before from
    expect([bad.status, await code(bad)]).toEqual([422, "invalid_assignment"])
    // history: the ended assignment shows in GET /v1/shifts and gives shifts for the days it covered
    expect((await w.json(await w.req("GET", "/v1/shifts", w.ops))).assignments.find((a: Json) => a.id === started.id).until).toBe("2026-11-15")
    expect((await w.occ(w.ops, "2026-11-14", "2026-11-17", `&userId=${w.staff.userId}`)).map((o) => o.shiftDate)).toEqual(["2026-11-14", "2026-11-15"])
  })
})

describe("scope", () => {
  test("a staff-home reader gets only their own cut of GET /v1/shifts (own assignments, their patterns, own override, their teams' defaults, their primary manager)", async () => {
    const w = await world()
    const A = await w.team("A", [w.staff.userId, w.staff2.userId])
    const B = await w.team("B", [w.staff2.userId])
    const C = await w.team("C")
    const pa = await w.pattern(w.ops, A, { name: "A-day", start: "07:00", end: "15:00" })
    const pb = await w.pattern(w.ops, B, { name: "B-day", start: "07:00", end: "15:00" })
    const pc = await w.pattern(w.ops, C, { name: "C-day", start: "07:00", end: "15:00" })
    await w.assign(w.ops, w.staff.userId, pa.id)
    await w.assign(w.ops, w.staff2.userId, pa.id)
    await w.assign(w.ops, w.staff2.userId, pb.id)
    await w.assign(w.ops, w.staff3.userId, pc.id)
    await w.manages(w.manager, w.staff)
    await w.manages(w.ops, w.staff2)
    for (const t of [A, B, C]) await w.req("PUT", `/v1/shifts/reporting/teams/${t}`, w.ops, { on: true })
    await w.req("PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, w.ops, { on: false })
    await w.req("PUT", `/v1/shifts/reporting/people/${w.staff2.userId}`, w.ops, { on: false })
    const mine = await w.json(await w.req("GET", "/v1/shifts", w.staff))
    expect(mine.patterns.map((p: Json) => p.id)).toEqual([pa.id])
    expect(mine.assignments.map((a: Json) => [a.userId, a.patternId])).toEqual([[w.staff.userId, pa.id]])
    expect(mine.members).toEqual([{ userId: w.staff.userId, teams: [A], managerId: w.manager.userId }])
    expect(mine.reporting).toEqual({ dueAfterMinutes: 60, teamDefaults: { [A]: true }, overrides: { [w.staff.userId]: false } })
    const text = JSON.stringify(mine)
    for (const other of [w.staff2.userId, w.staff3.userId, w.ops.userId, w.owner.userId, B, C, pb.id, pc.id]) expect(text, other).not.toContain(other)
    // occurrences: own only, whatever userId is asked
    const own = await w.occ(w.staff, "2026-10-20", "2026-10-20")
    expect(own.map((o) => o.userId)).toEqual([w.staff.userId])
    expect(await w.occ(w.staff, "2026-10-20", "2026-10-20", `&userId=${w.staff2.userId}`)).toEqual([])
    // a manager-home reader sees everything
    const all = await w.json(await w.req("GET", "/v1/shifts", w.manager))
    expect(all.patterns).toHaveLength(3)
    expect(all.members.length).toBeGreaterThanOrEqual(6)
    // staff cannot write
    for (const [m, path, b] of [["POST", "/v1/shifts/patterns", { name: "x", teamId: A, start: "07:00", end: "15:00", days: [1] }], ["PUT", `/v1/shifts/reporting/teams/${A}`, { on: true }]] as [string, string, unknown][]) {
      expect((await w.req(m, path, w.staff, b)).status, path).toBe(403)
    }
  })

  test("a team-scope manager assigns a direct report (201) and themself, not another team's member (422 assignee_out_of_scope); pattern POST, team default and out-of-scope edits are refused", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    await w.manages(w.manager, w.staff)
    const post = (u: Who, from = "2026-11-20") => w.req("POST", "/v1/shifts/assignments", w.manager, { userId: u.userId, patternId: p.id, from })
    const mine = await post(w.staff)
    expect(mine.status).toBe(201)
    expect((await post(w.manager)).status).toBe(201)
    const out = await post(w.staff2)
    expect([out.status, await code(out)]).toEqual([422, "assignee_out_of_scope"])
    expect(await w.q("select count(*)::int n from shift_assignments")).toEqual([{ n: 2 }])
    expect((await w.req("POST", "/v1/shifts/patterns", w.manager, { name: "Mine", teamId: A, start: "07:00", end: "15:00", days: [1] })).status).toBe(403)
    expect((await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.manager, { version: 1, name: "x" })).status).toBe(403)
    expect((await w.req("DELETE", `/v1/shifts/patterns/${p.id}`, w.manager)).status).toBe(403)
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.manager, { on: true })).status).toBe(403)
    // per-person override: a direct report yes, another team's member 422
    expect((await w.req("PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, w.manager, { on: true })).status).toBe(200)
    const oo = await w.req("PUT", `/v1/shifts/reporting/people/${w.staff2.userId}`, w.manager, { on: true })
    expect([oo.status, await code(oo)]).toEqual([422, "assignee_out_of_scope"])
    // an assignment of someone outside the scope is the same 404 as an unknown one (no oracle)
    const theirs = await w.assign(w.ops, w.staff2.userId, p.id, "2026-12-01")
    for (const [m, b] of [["PATCH", { until: "2026-12-31" }], ["DELETE", undefined]] as [string, unknown][]) {
      const r = await w.req(m, `/v1/shifts/assignments/${theirs.id}`, w.manager, b)
      expect([m, r.status, await code(r)]).toEqual([m, 404, "shift_assignment_not_found"])
    }
    // but their own report's assignment can be ended
    expect((await w.req("PATCH", `/v1/shifts/assignments/${(await mine.json() as Json).id}`, w.manager, { until: "2026-11-25" })).status).toBe(200)
    // an all-scope manager does all of it
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: true })).status).toBe(200)
  })

  test("API keys act as their creator: an all-scope creator's key writes patterns (audited as the key), a team-scope creator's key is 403 on patterns, a staff creator's key reads only their cut", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    await w.assign(w.ops, w.staff.userId, p.id)
    await w.assign(w.ops, w.staff2.userId, p.id)
    const bearer = (k: { key: string }) => ({ authorization: `Bearer ${k.key}` })
    const opsKey = await makeApiKey(w.deps, w.tenant.id, w.ops.userId, ["shifts:read", "shifts:write"])
    const mk = await call(w.app, "POST", "/v1/shifts/patterns", { tenant: w.slug, headers: bearer(opsKey), body: { name: "ByKey", teamId: A, start: "07:00", end: "15:00", days: [1] } })
    expect(mk.status, await mk.clone().text()).toBe(201)
    const [a] = await w.q("select actor_id from audit_events where action = 'shift.pattern_created' order by seq desc limit 1")
    expect(a.actor_id).toBe(`apikey:${opsKey.id}`)
    const mgrKey = await makeApiKey(w.deps, w.tenant.id, w.manager.userId, ["shifts:read", "shifts:write"])
    expect((await call(w.app, "POST", "/v1/shifts/patterns", { tenant: w.slug, headers: bearer(mgrKey), body: { name: "ByMgr", teamId: A, start: "07:00", end: "15:00", days: [1] } })).status).toBe(403)
    const staffKey = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["shifts:read"])
    const cut = await (await call(w.app, "GET", "/v1/shifts", { tenant: w.slug, headers: bearer(staffKey) })).json() as Json
    expect(cut.assignments.map((x: Json) => x.userId)).toEqual([w.staff.userId])
    expect(JSON.stringify(cut)).not.toContain(w.staff2.userId)
    expect((await call(w.app, "POST", "/v1/shifts/patterns", { tenant: w.slug, headers: bearer(staffKey), body: { name: "x", teamId: A, start: "07:00", end: "15:00", days: [1] } })).status).toBe(403)
  })

  test("occurrences range: 31 dates are fine, 32 are 422 range_too_long, from after to or a bad date is 422 invalid_range", async () => {
    const w = await world()
    expect((await w.req("GET", "/v1/shifts/occurrences?from=2026-10-01&to=2026-10-31", w.ops)).status).toBe(200)
    expect(await code(await w.req("GET", "/v1/shifts/occurrences?from=2026-10-01&to=2026-11-01", w.ops))).toBe("range_too_long")
    expect(await code(await w.req("GET", "/v1/shifts/occurrences?from=2026-10-05&to=2026-10-04", w.ops))).toBe("invalid_range")
    expect(await code(await w.req("GET", "/v1/shifts/occurrences?from=2026-02-30&to=2026-03-01", w.ops))).toBe("invalid_range")
    expect((await w.req("GET", "/v1/shifts/occurrences?from=nope&to=2026-03-01", w.ops)).status).toBe(400)
    expect((await w.req("GET", "/v1/shifts/occurrences", w.ops)).status).toBe(400)
  })
})

describe("tenancy", () => {
  test("every shift route: another tenant's pattern, assignment, team or user id → 404 with the resource code; no cross-tenant write", async () => {
    const a = await world()
    const b = await world({ slug: "bravo" })
    const A2 = await a.team("A")
    const B2 = await b.team("B")
    const bp = await b.pattern(b.ops, B2)
    const ba = await b.assign(b.ops, b.staff.userId, bp.id, "2026-12-01")
    const ap = await a.pattern(a.ops, A2)
    const before = JSON.stringify([await b.q("select * from shift_patterns order by id"), await b.q("select * from shift_assignments order by id"), await b.q("select * from shift_reporting_teams"), await b.q("select * from shift_reporting_people")])
    const want = async (r: Response, status: number, c: string) => expect([r.status, await code(r)]).toEqual([status, c])
    await want(await a.req("PATCH", `/v1/shifts/patterns/${bp.id}`, a.ops, { version: 1, name: "hax" }), 404, "shift_pattern_not_found")
    await want(await a.req("DELETE", `/v1/shifts/patterns/${bp.id}`, a.ops), 404, "shift_pattern_not_found")
    await want(await a.req("PATCH", `/v1/shifts/assignments/${ba.id}`, a.ops, { until: "2026-12-31" }), 404, "shift_assignment_not_found")
    await want(await a.req("DELETE", `/v1/shifts/assignments/${ba.id}`, a.ops), 404, "shift_assignment_not_found")
    await want(await a.req("PUT", `/v1/shifts/reporting/teams/${B2}`, a.ops, { on: true }), 404, "team_not_found")
    await want(await a.req("PUT", `/v1/shifts/reporting/people/${b.staff.userId}`, a.ops, { on: true }), 404, "not_a_member")
    await want(await a.req("POST", "/v1/shifts/assignments", a.ops, { userId: a.staff.userId, patternId: bp.id, from: "2026-12-01" }), 404, "shift_pattern_not_found")
    await want(await a.req("POST", "/v1/shifts/assignments", a.ops, { userId: b.staff.userId, patternId: ap.id, from: "2026-12-01" }), 422, "invalid_assignment")
    await want(await a.req("POST", "/v1/shifts/patterns", a.ops, { name: "x", teamId: B2, start: "07:00", end: "15:00", days: [1] }), 404, "team_not_found")
    await want(await a.req("PATCH", `/v1/shifts/patterns/${ap.id}`, a.ops, { version: 1, teamId: B2 }), 404, "team_not_found")
    // B's data never appears in A's reads
    expect(JSON.stringify(await a.json(await a.req("GET", "/v1/shifts", a.ops)))).not.toContain(bp.id)
    expect(await a.occ(a.ops, "2026-12-01", "2026-12-02", `&userId=${b.staff.userId}`)).toEqual([])
    const after = JSON.stringify([await b.q("select * from shift_patterns order by id"), await b.q("select * from shift_assignments order by id"), await b.q("select * from shift_reporting_teams"), await b.q("select * from shift_reporting_people")])
    expect(after).toBe(before)
  })

  test("removing M1 → 403 module_not_entitled within 60 s on every shift route; rows untouched; re-enabling restores them", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A)
    const a = await w.assign(w.ops, w.staff.userId, p.id, "2026-12-01")
    expect((await w.req("GET", "/v1/shifts", w.ops)).status).toBe(200) // entitlement cached now
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const [m, path, b] of [
      ["GET", "/v1/shifts", undefined], ["GET", "/v1/shifts/occurrences?from=2026-10-01&to=2026-10-02", undefined], ["POST", "/v1/shifts/patterns", { name: "x", teamId: A, start: "07:00", end: "15:00", days: [1] }],
      ["PATCH", `/v1/shifts/patterns/${p.id}`, { version: 1, name: "x" }], ["DELETE", `/v1/shifts/patterns/${p.id}`, undefined],
      ["POST", "/v1/shifts/assignments", { userId: w.staff.userId, patternId: p.id, from: "2027-01-01" }], ["PATCH", `/v1/shifts/assignments/${a.id}`, { until: "2026-12-31" }],
      ["DELETE", `/v1/shifts/assignments/${a.id}`, undefined], ["PUT", `/v1/shifts/reporting/teams/${A}`, { on: true }], ["PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, { on: true }],
    ] as [string, string, unknown][]) {
      const r = await w.req(m, path, w.ops, b)
      expect([m, path, r.status, await code(r)]).toEqual([m, path, 403, "module_not_entitled"])
    }
    expect((await w.q("select count(*)::int n from shift_patterns where archived_at is null"))[0].n).toBe(1)
    expect((await w.q("select count(*)::int n from shift_assignments"))[0].n).toBe(1)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    w.clock.advance({ minutes: 1 })
    expect((await w.req("GET", "/v1/shifts", w.ops)).status).toBe(200)
  })

  test("RLS: a tenant-A tx cannot read or insert tenant-B shift rows (error on .cause); app_user cannot DELETE shift_patterns; grants are minimal; all four tables are FORCEd", async () => {
    const a = await world()
    const b = await world({ slug: "bravo" })
    const B2 = await b.team("B")
    const bp = await b.pattern(b.ops, B2)
    await b.assign(b.ops, b.staff.userId, bp.id)
    await b.req("PUT", `/v1/shifts/reporting/teams/${B2}`, b.ops, { on: true })
    await b.req("PUT", `/v1/shifts/reporting/people/${b.staff.userId}`, b.ops, { on: true })
    const as = (tenantId: string, stmt: ReturnType<typeof sql>) => withTenant(a.deps.db, tenantId, (tx) => tx.execute(stmt))
    for (const t of ["shift_patterns", "shift_assignments", "shift_reporting_teams", "shift_reporting_people"]) {
      expect((await as(a.tenant.id, sql.raw(`select 1 from ${t}`))).rows, t).toHaveLength(0)
      expect((await ownerQuery(`select relforcerowsecurity f, relrowsecurity r from pg_class where relname = '${t}'`))[0]).toEqual({ f: true, r: true })
    }
    const c42501 = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code
    const crossInsert = [
      sql`insert into shift_patterns (tenant_id, team_id, name, start_time, end_time, days, created_at, updated_at) values (${b.tenant.id}, ${B2}, 'x', '07:00', '15:00', '{1}', now(), now())`,
      sql`insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, created_at) values (${b.tenant.id}, ${b.staff.userId}, ${bp.id}, '2026-10-01', now())`,
      sql`insert into shift_reporting_teams (tenant_id, team_id, "on", updated_at) values (${b.tenant.id}, ${B2}, true, now())`,
      sql`insert into shift_reporting_people (tenant_id, user_id, "on", updated_at) values (${b.tenant.id}, ${b.staff2.userId}, true, now())`,
    ]
    for (const stmt of crossInsert) expect(c42501(await as(a.tenant.id, stmt).catch((e) => e)), String(stmt)).toBe("42501")
    // app_user cannot DELETE patterns, cannot rewrite tenant_id or ids
    for (const stmt of [sql`delete from shift_patterns`, sql`update shift_patterns set tenant_id = gen_random_uuid()`, sql`update shift_patterns set id = gen_random_uuid()`, sql`update shift_assignments set user_id = 'x'`, sql`update shift_assignments set from_date = '2020-01-01'`, sql`delete from shift_reporting_teams`, sql`update shift_reporting_people set user_id = 'x'`]) {
      expect(c42501(await as(b.tenant.id, stmt).catch((e) => e)), String(stmt)).toBe("42501")
    }
    const tbl = async (t: string) => (await ownerQuery(`select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = $1 order by 1`, [t])).map((r) => r.privilege_type)
    const col = async (t: string) => (await ownerQuery(`select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = $1 and privilege_type = 'UPDATE' order by 1`, [t])).map((r) => r.column_name)
    expect(await tbl("shift_patterns")).toEqual(["INSERT", "SELECT"])
    expect(await col("shift_patterns")).toEqual(["archived_at", "days", "end_time", "name", "start_time", "team_id", "time_zone", "updated_at", "version"])
    expect(await tbl("shift_assignments")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("shift_assignments")).toEqual(["until_date"])
    expect(await tbl("shift_reporting_teams")).toEqual(["INSERT", "SELECT"])
    expect(await col("shift_reporting_teams")).toEqual(["on", "updated_at", "updated_by"])
    expect(await tbl("shift_reporting_people")).toEqual(["DELETE", "INSERT", "SELECT"])
    expect(await col("shift_reporting_people")).toEqual(["on", "updated_at", "updated_by"])
    // a composite FK keeps a row inside one tenant even for the owner
    const err = await ownerTenantQuery(a.tenant.id, `insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, created_at) values ($1, $2, $3, '2026-10-01', now())`, [a.tenant.id, a.staff.userId, bp.id]).catch((e) => e)
    expect(String((err as Error).message)).toContain("shift_assignments_pattern_fk")
  })
})

describe("events and audit", () => {
  test("shift events carry ids only and none is in WEBHOOK_EVENT_TYPES; every mutation is audited with its actor", async () => {
    const w = await world()
    const A = await w.team("A")
    const p = await w.pattern(w.ops, A, { name: "Secret name" })
    const a = await w.assign(w.ops, w.staff.userId, p.id, "2026-12-01")
    await w.req("PATCH", `/v1/shifts/assignments/${a.id}`, w.ops, { until: "2026-12-31" })
    await w.req("PATCH", `/v1/shifts/assignments/${a.id}`, w.ops, { until: null })
    await w.req("DELETE", `/v1/shifts/assignments/${a.id}`, w.ops)
    await w.req("PUT", `/v1/shifts/reporting/teams/${A}`, w.ops, { on: true })
    await w.req("PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, w.ops, { on: false })
    await w.req("PATCH", `/v1/shifts/patterns/${p.id}`, w.ops, { version: 1, name: "Renamed" })
    await w.req("DELETE", `/v1/shifts/patterns/${p.id}`, w.ops)
    const ev = await w.q("select type, payload from domain_events where type like 'shift.%' order by occurred_at, id")
    expect(ev.map((e) => e.type).sort()).toEqual(
      ["shift.assigned", "shift.assigned", "shift.pattern_archived", "shift.pattern_created", "shift.pattern_updated", "shift.reporting_changed", "shift.reporting_changed", "shift.unassigned", "shift.unassigned"].sort(),
    )
    const ids = /^[A-Za-z0-9_-]{8,64}$/
    for (const e of ev) for (const [k, v] of Object.entries(e.payload as Json)) expect(v === null || ids.test(String(v)), `${e.type}.${k}`).toBe(true)
    expect(JSON.stringify(ev)).not.toContain("Secret name")
    for (const t of new Set(ev.map((e) => e.type as string))) expect(WEBHOOK_EVENT_TYPES as readonly string[]).not.toContain(t)
    const audits = await w.q("select action, actor_id from audit_events where action like 'shift.%' order by seq")
    expect(audits.map((x) => x.action)).toEqual([
      "shift.pattern_created", "shift.assigned", "shift.unassigned", "shift.assigned", "shift.unassigned", "shift.reporting_changed", "shift.reporting_changed", "shift.pattern_updated", "shift.pattern_archived",
    ])
    expect(new Set(audits.map((x) => x.actor_id))).toEqual(new Set([w.ops.userId]))
  })
})

describe("query plans at 10k rows (EXPLAIN)", () => {
  test("the live-pattern list uses shift_patterns_team_idx; the assignment window uses shift_assignments_user_idx (a member) and shift_assignments_pattern_idx (everyone)", async () => {
    const w = await world()
    const A = await w.team("A")
    await w.pattern(w.ops, A, { name: "P0" })
    // 3000 patterns (most archived) and 12000 assignments in one tenant
    await w.q(
      `insert into shift_patterns (tenant_id, team_id, name, start_time, end_time, days, archived_at, created_at, updated_at)
       select $1::uuid, $2::uuid, 'Q' || g, '07:00', '15:00', '{1,2}'::smallint[], case when g % 10 = 0 then null else now() end, now(), now() from generate_series(1, 3000) g`,
      [w.tenant.id, A],
    )
    // real members are needed for the composite FK: reuse the 6 world members round-robin
    const users = [w.owner, w.manager, w.ops, w.staff, w.staff2, w.staff3].map((u) => u.userId)
    await w.q(
      `insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, until_date, created_at)
       select $1::uuid, ($2::text[])[1 + g % 6], (select id from shift_patterns where name = 'Q' || (1 + g % 3000)), date '2026-01-01' + (g % 300), case when g % 3 = 0 then date '2026-01-01' + (g % 300) + 20 end, now() from generate_series(1, 12000) g`,
      [w.tenant.id, users],
    )
    await ownerQuery("analyze shift_patterns")
    await ownerQuery("analyze shift_assignments")
    const ids = (await w.q("select id from shift_patterns where archived_at is null limit 5")).map((r) => String(r.id))
    const plans = await withTenant(w.deps.db, w.tenant.id, async (tx) => [
      livePatternsQuery(tx, w.tenant.id).toSQL(),
      assignmentsInWindowQuery(tx, w.tenant.id, "2026-10-19", "2026-10-25", { patternIds: ids, userIds: [w.staff.userId] }).toSQL(),
      assignmentsInWindowQuery(tx, w.tenant.id, "2026-10-19", "2026-10-25", { patternIds: ids }).toSQL(),
    ])
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    try {
      const out: string[] = []
      for (const pl of plans) {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
        out.push((await c.query(`explain ${pl.sql}`, pl.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n"))
        await c.query("rollback")
      }
      expect(out[0]).toContain("shift_patterns_team_idx")
      expect(out[0]).not.toMatch(/Seq Scan on shift_patterns/)
      expect(out[1]).toMatch(/shift_assignments_user_idx|shift_assignments_pattern_idx/)
      expect(out[1]).not.toMatch(/Seq Scan on shift_assignments/)
      expect(out[2]).toContain("shift_assignments_pattern_idx")
      expect(out[2]).not.toMatch(/Seq Scan on shift_assignments/)
    } finally {
      await c.end()
    }
  }, 120_000)
})
