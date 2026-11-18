import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import type { Context } from "hono"
import { beforeEach, describe, expect, test } from "vitest"
import { RULE_IDS } from "@opsdesk/domain/roster-rules"
import { addDays, wallToEpoch } from "@opsdesk/domain/shifts"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb, testApp } from "../../../test/harness"
import type { AppEnv } from "../../core/context"
import { loadRole } from "../../core/middleware/permission"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { loadRosterCtx, type RosterCtx } from "."
import { checkWeek, DEFAULT_SEVERITY, loadRuleContext } from "./rules"

// B8 Task 8: the server rule engine (FR-RS-44), tenant severities, the check endpoint and hidden-site masking.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { userId: string; email: string; password: string }
beforeEach(resetDb)
const TZ = "Europe/Dublin"

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const p: Record<string, Who> = {}
  for (const k of ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]) p[k] = await makeMember(t.deps, tenant.id, k)
  const sup2 = await makeMember(t.deps, tenant.id, "location-supervisor")
  const staff2 = await makeMember(t.deps, tenant.id, "employee")
  const cookies = new Map<string, string>()
  const cookie = async (who: Who) => {
    if (!cookies.has(who.email)) cookies.set(who.email, (await signIn(t.app, who.email, who.password)).cookie)
    return cookies.get(who.email)!
  }
  /** A PUT of the rules sends the ETag of what the caller just loaded (If-Match) unless `headers` says otherwise. */
  const req = async (method: string, path: string, who: Who, body?: unknown, headers?: Record<string, string>) => {
    const base = { cookie: await cookie(who), tenant: "acme" }
    if (method === "PUT" && path === "/v1/roster/rules" && !headers) {
      const etag = (await call(t.app, "GET", path, base)).headers.get("etag")
      return call(t.app, method, path, { ...base, body, headers: etag ? { "if-match": etag } : {} })
    }
    return call(t.app, method, path, { ...base, body, headers })
  }
  const ok = async (method: string, path: string, who: Who, body?: unknown, status = 200): Promise<Json> => {
    const r = await req(method, path, who, body)
    const text = await r.text()
    expect(r.status, `${method} ${path} -> ${text}`).toBe(status)
    return text ? JSON.parse(text) : {}
  }
  const code = async (method: string, path: string, who: Who, body: unknown, status: number): Promise<string> => {
    const r = await req(method, path, who, body)
    expect(r.status, `${method} ${path}`).toBe(status)
    return ((await r.json()) as Json).code as string
  }
  const rows = (sql: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, sql, params) as Promise<Json[]>
  for (const [who, name] of [[p.employee, "Aoife Byrne"], [staff2, "Cian Doyle"], [p.owner, "Olive Owner"], [p["location-supervisor"], "Sinead Sup"]] as const) await ownerQuery(`update "user" set name = $1 where id = $2`, [name, who.userId])
  const loc = async (name: string) => (await ok("POST", "/v1/locations", p.owner, { name }, 201)).id as string
  const type = async (locationId: string, name: string, o: Json = {}) => (await ok("POST", `/v1/locations/${locationId}/shift-types`, p.owner, { name, start: "08:00", end: "16:00", role: "Guard", ...o }, 201)).id as string
  const weeks = new Map<string, string>()
  const week = async (locationId: string, weekStart: string) => {
    const key = `${locationId}|${weekStart}`
    if (!weeks.has(key)) weeks.set(key, (await rows("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, $3, now(), now()) returning id", [tenant.id, locationId, weekStart]))[0].id)
    return weeks.get(key)!
  }
  /** A rostered shift of `user` (null = open) on `date`, wall times in the tenant zone; an end at or before the start runs into the next day. */
  const shift = async (o: { loc: string; type: string; user: string | null; date: string; start: string; end: string; weekStart: string }) => {
    const endDate = o.end <= o.start ? addDays(o.date, 1) : o.date
    const startAt = new Date(wallToEpoch(`${o.date}T${o.start}`, TZ))
    const endAt = new Date(wallToEpoch(`${endDate}T${o.end}`, TZ))
    const wk = await week(o.loc, o.weekStart)
    return (await rows(
      "insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, 'Guard', $7, $8, $9, $10, now(), now()) returning id",
      [tenant.id, wk, o.loc, o.date, o.user, o.type, o.start, o.end, startAt.toISOString(), endAt.toISOString()],
    ))[0].id as string
  }
  const check = (who: Who, weekId: string) => req("POST", `/v1/roster/weeks/${weekId}/check`, who)
  const violations = async (who: Who, weekId: string): Promise<Json[]> => (await ok("POST", `/v1/roster/weeks/${weekId}/check`, who)).violations
  /** The caller's RosterCtx the way a handler gets it (real role row, real tenant tx). */
  const ctxOf = async <T>(who: { userId: string }, fn: (tx: TenantTx, ctx: RosterCtx) => Promise<T>, o: { wrap?: (tx: TenantTx) => TenantTx } = {}): Promise<T> => {
    const [m] = await rows("select role_id from memberships where user_id = $1", [who.userId])
    const bag = new Map<string, unknown>([["tenant", { id: tenant.id, timezone: TZ }], ["member", { userId: who.userId, roleId: m.role_id }], ["deps", t.deps]])
    const c = { get: (k: string) => bag.get(k), set: (k: string, v: unknown) => bag.set(k, v) } as unknown as Context<AppEnv>
    await loadRole(c)
    return withTenant(t.deps.db, tenant.id, async (tx) => {
      const ctx = await loadRosterCtx(c, tx, "read")
      return fn(o.wrap ? o.wrap(tx) : tx, ctx)
    })
  }
  return { ...t, tenant, other, p, sup2, staff2, cookies, req, ok, code, rows, loc, type, week, shift, check, violations, ctxOf }
}

/** Alpha (supervised by `location-supervisor`) and Bravo (supervised by sup2); nobody has a home location unless a test sets one. */
async function sites() {
  const w = await world()
  const [a, b] = [await w.loc("Alpha"), await w.loc("Bravo")]
  await w.ok("PUT", `/v1/locations/${a}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
  await w.ok("PUT", `/v1/locations/${b}/supervisors`, w.p.owner, { userIds: [w.sup2.userId] })
  const [ta, tb] = [await w.type(a, "Day"), await w.type(b, "Day")]
  return { ...w, a, b, ta, tb }
}

const MON = "2026-11-02"
const rule = (v: Json[], r: string) => v.filter((x) => x.rule === r)

describe("the check endpoint (FR-RS-44)", () => {
  test("AC-RS-04: a shift leaving 10 h rest produces a daily_rest warning naming the person and both shifts", async () => {
    const w = await sites()
    const staff = w.p.employee
    const [s1, s2] = [
      await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON }),
      await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-11-03", start: "02:00", end: "10:00", weekStart: MON }),
    ]
    const wk = await w.week(w.a, MON)
    const v = await w.violations(w.p.owner, wk)
    const rest = rule(v, "daily_rest")
    expect(rest.map((x) => x.shiftId).sort()).toEqual([s1, s2].sort()) // flagged from both sides
    const late = rest.find((x) => x.shiftId === s2)!
    expect(late).toMatchObject({ severity: "warn", personId: staff.userId, otherShiftIds: [s1] })
    expect(late.message).toContain("Aoife Byrne")
    expect(late.message).toContain("2026-11-02 08:00-16:00")
    expect(late.message).toContain("2026-11-03 02:00-10:00")
    expect(late.message).toContain("10h00")
    // 11 h exactly passes
    await w.rows("update roster_shifts set start_time = '03:00', end_time = '11:00', start_at = $2, end_at = $3 where id = $1", [s2, new Date(wallToEpoch("2026-11-03T03:00", TZ)).toISOString(), new Date(wallToEpoch("2026-11-03T11:00", TZ)).toISOString()])
    expect(rule(await w.violations(w.p.owner, wk), "daily_rest")).toEqual([])
  })

  test("double_booking and approved_leave are block by default, the rest warn; severities come from the tenant setting (changing it changes the result)", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON })
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "12:00", end: "20:00", weekStart: MON }) // overlaps; also leaves under 11 h to the next day's 04:00
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-11-03", start: "04:00", end: "12:00", weekStart: MON })
    const leave = (await w.ok("POST", "/v1/leave", staff, { from: "2026-11-03", to: "2026-11-03", kind: "annual", note: "" }, 201)).id
    await w.ok("POST", `/v1/leave/${leave}/decide`, w.p.owner, { decision: "approve", note: "" })
    const wk = await w.week(w.a, MON)
    expect(await w.ok("GET", "/v1/roster/rules", w.p.owner)).toEqual({ severity: DEFAULT_SEVERITY, avgWeekReferenceWeeks: 17 })
    expect(DEFAULT_SEVERITY).toMatchObject({ double_booking: "block", approved_leave: "block" })
    for (const r of RULE_IDS.filter((x) => x !== "double_booking" && x !== "approved_leave")) expect(DEFAULT_SEVERITY[r], r).toBe("warn")
    const before = await w.violations(w.p.owner, wk)
    expect(new Set(rule(before, "double_booking").map((x) => x.severity))).toEqual(new Set(["block"]))
    expect(new Set(rule(before, "approved_leave").map((x) => x.severity))).toEqual(new Set(["block"]))
    expect(new Set(rule(before, "daily_rest").map((x) => x.severity))).toEqual(new Set(["warn"]))
    expect(before.some((x) => x.severity === "block")).toBe(true)
    // the tenant flips three of them
    await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { ...DEFAULT_SEVERITY, double_booking: "warn", approved_leave: "ignore", daily_rest: "block" }, avgWeekReferenceWeeks: 17 })
    const after = await w.violations(w.p.owner, wk)
    expect(new Set(rule(after, "double_booking").map((x) => x.severity))).toEqual(new Set(["warn"]))
    expect(rule(after, "approved_leave")).toEqual([]) // ignore: nothing reported
    expect(new Set(rule(after, "daily_rest").map((x) => x.severity))).toEqual(new Set(["block"]))
    expect(await w.ok("GET", "/v1/roster/rules", w.staff2)).toMatchObject({ severity: { double_booking: "warn", approved_leave: "ignore", daily_rest: "block" } }) // anyone with roster read
  })

  test("Review Focus 3: night shift 22:00-06:00 on 24 Oct 2026 is 9 real hours; rest after it is counted in real time; 48 h average uses the configured window", async () => {
    const w = await sites()
    const staff = w.p.employee
    const WK = "2026-10-19"
    await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { ...DEFAULT_SEVERITY }, avgWeekReferenceWeeks: 1 })
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: d, start: "08:00", end: "16:00", weekStart: WK })
    const night = await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-10-24", start: "22:00", end: "06:00", weekStart: WK })
    const wk = await w.week(w.a, WK)
    const avg = rule(await w.violations(w.p.owner, wk), "avg_48h").filter((x) => x.shiftId === night)
    expect(avg).toHaveLength(1)
    expect(avg[0].message).toContain("49.0h a week over 1 weeks") // 5 x 8 + 9 real hours across the 25 Oct fall-back
    // a window of 4 weeks dilutes it: 49 / 4 is far below 48
    await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { ...DEFAULT_SEVERITY }, avgWeekReferenceWeeks: 4 })
    expect(rule(await w.violations(w.p.owner, wk), "avg_48h")).toEqual([])
    // rest after a clock change is real time: 00:30 BST to 10:30 GMT reads 10 h on the wall but is 11 h real (passes); 09:30 is 10 h real (warns)
    const ok1 = await w.shift({ loc: w.a, type: w.ta, user: w.staff2.userId, date: "2026-10-24", start: "16:30", end: "00:30", weekStart: WK })
    const ok2 = await w.shift({ loc: w.a, type: w.ta, user: w.staff2.userId, date: "2026-10-25", start: "10:30", end: "18:30", weekStart: WK })
    expect(rule(await w.violations(w.p.owner, wk), "daily_rest").filter((x) => [ok1, ok2].includes(x.shiftId))).toEqual([])
    await w.rows("update roster_shifts set start_time = '09:30', end_time = '17:30' where id = $1", [ok2])
    const bad = rule(await w.violations(w.p.owner, wk), "daily_rest").find((x) => x.shiftId === ok2)!
    expect(bad.message).toContain("10h00")
  })

  test("Review Focus 1: a supervisor's check of a shift that clashes with a hidden site's shift returns \"Already rostered elsewhere\" with no site name, time or shift id; JSON.stringify has none of them", async () => {
    const w = await sites()
    const staff = w.p.employee
    const hidden = await w.shift({ loc: w.b, type: w.tb, user: staff.userId, date: MON, start: "18:00", end: "22:00", weekStart: MON }) // Bravo: not visible to Alpha's supervisor
    const mine = await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "20:00", end: "23:00", weekStart: MON })
    const nextDay = await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-11-03", start: "04:00", end: "08:00", weekStart: MON }) // under 11 h after the hidden 22:00
    const wk = await w.week(w.a, MON)
    const bravoWeek = await w.week(w.b, MON)
    const res = await w.check(w.p["location-supervisor"], wk)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Json
    const clash = rule(body.violations, "elsewhere").filter((x) => x.shiftId === mine)
    expect(clash).toHaveLength(1)
    expect(clash[0]).toMatchObject({ shiftId: mine, severity: "block", message: "Already rostered elsewhere", otherShiftIds: [] }) // one generic line: no rule-specific wording
    expect(rule(body.violations, "double_booking").filter((x) => x.shiftId === mine)).toEqual([]) // the hidden overlap is not reported as a double booking
    const rest = rule(body.violations, "daily_rest").filter((x) => x.shiftId === nextDay)
    expect(rest.flatMap((x) => x.otherShiftIds)).toEqual([mine]) // the visible neighbour is named, the hidden one is not
    const gen = rule(body.violations, "elsewhere").filter((x) => x.shiftId === nextDay)
    expect(gen).toHaveLength(1)
    expect(gen[0]).toMatchObject({ message: "Already rostered elsewhere", otherShiftIds: [], severity: "warn" })
    const text = JSON.stringify(body)
    for (const secret of [hidden, w.b, bravoWeek, "Bravo", "18:00", "22:00", "2026-11-02 18"]) expect(text, `leaks ${secret}`).not.toContain(secret)
    // an office role that sees every site gets the detail
    const full = rule(await w.violations(w.p.admin, wk), "double_booking")
    expect(full.some((x) => x.otherShiftIds.includes(hidden) && x.message.includes("18:00-22:00"))).toBe(true)
    expect(rule(await w.violations(w.p.admin, wk), "elsewhere")).toEqual([]) // a caller who sees every site gets the detail, never the generic line
    // an office Roster Manager excepted from Bravo is cut the same way as the supervisor
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    const rmText = JSON.stringify(await w.ok("POST", `/v1/roster/weeks/${wk}/check`, w.p["roster-manager"]))
    expect(rmText).toContain("Already rostered elsewhere")
    for (const secret of [hidden, w.b, "Bravo", "18:00"]) expect(rmText).not.toContain(secret)
  })

  test("avg_48h text for a caller who does not see every location carries no hour total (hidden-site hours still count)", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { ...DEFAULT_SEVERITY }, avgWeekReferenceWeeks: 1 })
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) await w.shift({ loc: w.b, type: w.tb, user: staff.userId, date: d, start: "08:00", end: "18:00", weekStart: MON }) // 50 h at the hidden site
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-11-07", start: "08:00", end: "12:00", weekStart: MON })
    const wk = await w.week(w.a, MON)
    const all = await w.violations(w.p["location-supervisor"], wk)
    const cut = rule(all, "elsewhere")
    expect(cut).toHaveLength(1) // the average, the weekly rest and the rest all built on hidden hours are ONE line
    expect(cut[0].message).toBe("Already rostered elsewhere")
    expect(rule(all, "avg_48h")).toEqual([])
    expect(JSON.stringify(all)).not.toMatch(/\d+\.\dh|54|limit/)
    const full = rule(await w.violations(w.p.admin, wk), "avg_48h")
    expect(full[0].message).toMatch(/54\.0h a week over 1 weeks \(limit 48h\)/)
  })

  test("a deactivated member's shift gets the left violation; expired licence on a required type gets expired_licence", async () => {
    const w = await sites()
    const guarded = await w.type(w.a, "Armed", { requires: [" SIA Licence "] })
    const [gone, lapsed, fine, valid] = [w.staff2, w.p.employee, w.p.manager, w.p.admin]
    await w.rows("update memberships set status = 'deactivated', deactivated_at = $2 where user_id = $1", [gone.userId, "2026-11-02T10:00:00Z"])
    await w.rows("insert into member_qualifications (tenant_id, user_id, type, expires_on, created_at, updated_at) values ($1, $2, 'sia licence', '2026-10-01', now(), now()), ($1, $3, 'sia licence', '2026-11-04', now(), now())", [w.tenant.id, lapsed.userId, valid.userId])
    const sGone = await w.shift({ loc: w.a, type: w.ta, user: gone.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const sLapsed = await w.shift({ loc: w.a, type: guarded, user: lapsed.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const sValid = await w.shift({ loc: w.a, type: guarded, user: valid.userId, date: "2026-11-04", start: "08:00", end: "16:00", weekStart: MON }) // valid through its expiry date
    const sFine = await w.shift({ loc: w.a, type: w.ta, user: fine.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const v = await w.violations(w.p.owner, await w.week(w.a, MON))
    expect(rule(v, "left").map((x) => x.shiftId)).toEqual([sGone])
    expect(rule(v, "expired_licence").map((x) => x.shiftId)).toEqual([sLapsed])
    expect(rule(v, "expired_licence")[0].message).toContain("sia licence")
    expect(v.filter((x) => [sValid, sFine].includes(x.shiftId))).toEqual([])
  })

  test("check for a week of another location is 404; a non-uuid id answers exactly like a missing one; dry run writes nothing (no history, no audit, no event)", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON })
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "12:00", end: "20:00", weekStart: MON })
    const bravoWeek = await w.week(w.b, MON)
    const alphaWeek = await w.week(w.a, MON)
    const shape = async (who: Who, id: string) => {
      const r = await w.check(who, id)
      const j = (await r.json()) as Json
      return { status: r.status, code: j.code, title: j.title, detail: j.detail, ct: r.headers.get("content-type") }
    }
    for (const who of [w.p["location-supervisor"], w.p.owner]) {
      const missing = await shape(who, randomUUID())
      expect(missing.status).toBe(404)
      if (who === w.p.owner) expect((await w.check(who, bravoWeek)).status).toBe(200)
      else expect(await shape(who, bravoWeek)).toEqual(missing) // a week of a site the caller cannot see
      for (const bad of ["not-a-uuid", "1", "%27%20or%201%3D1", "00000000-0000-0000-0000-00000000000"]) expect(await shape(who, bad), `${who.email} ${bad}`).toEqual(missing)
    }
    const counts = async () => (await w.rows("select (select count(*) from roster_history)::int h, (select count(*) from audit_events)::int a, (select count(*) from domain_events)::int e, (select count(*) from roster_shifts)::int s, (select count(*) from notifications)::int n"))[0]
    const before = await counts()
    for (let i = 0; i < 3; i++) expect((await w.check(w.p.owner, alphaWeek)).status).toBe(200)
    expect(await counts()).toEqual(before)
    // staff and a read-only manager cannot run it at all
    for (const who of [w.staff2, w.p.manager]) expect((await w.check(who, alphaWeek)).status).toBe(403)
  })
})

describe("settings: GET and PUT /v1/roster/rules", () => {
  test("PUT: supervisor 403; unknown rule id 422; avgWeekReferenceWeeks outside 1..52 is 422; admin and owner change it with an audit line; an unchanged set writes nothing", async () => {
    const w = await sites()
    const good = { severity: { ...DEFAULT_SEVERITY, daily_rest: "block" }, avgWeekReferenceWeeks: 26 }
    for (const who of [w.p["location-supervisor"], w.p["roster-manager"], w.p.manager, w.p.employee]) expect((await w.req("PUT", "/v1/roster/rules", who, good)).status, who.email).toBe(403)
    expect(await w.ok("GET", "/v1/roster/rules", w.p.owner)).toEqual({ severity: DEFAULT_SEVERITY, avgWeekReferenceWeeks: 17 })
    expect(await w.code("PUT", "/v1/roster/rules", w.p.admin, { ...good, severity: { ...good.severity, not_a_rule: "warn" } }, 422)).toBe("invalid_rules")
    expect(await w.code("PUT", "/v1/roster/rules", w.p.admin, { ...good, severity: { ...good.severity, daily_rest: "panic" } }, 422)).toBe("invalid_rules")
    for (const weeks of [0, 53, -1, 1.5, 100]) expect(await w.code("PUT", "/v1/roster/rules", w.p.admin, { ...good, avgWeekReferenceWeeks: weeks }, 422), String(weeks)).toBe("invalid_avg_weeks")
    expect(await w.rows("select 1 from tenant_settings where key = 'roster.rules'")).toEqual([])
    expect(await w.ok("PUT", "/v1/roster/rules", w.p.admin, good)).toEqual(good)
    expect(await w.ok("GET", "/v1/roster/rules", w.staff2)).toEqual(good)
    const [a] = await w.rows("select actor_id, before, after, entity from audit_events where action = 'roster.rules_changed'")
    expect(a.actor_id).toBe(w.p.admin.userId)
    expect(a.entity).toBe("roster_rules")
    expect(a.before).toEqual({ severity: DEFAULT_SEVERITY, avgWeekReferenceWeeks: 17 })
    expect(a.after).toEqual(good)
    await w.ok("PUT", "/v1/roster/rules", w.p.owner, good) // unchanged: no second audit line
    expect(await w.rows("select 1 from audit_events where action = 'roster.rules_changed'")).toHaveLength(1)
    // a rule left out falls back to its default
    // AD4: a rule left out keeps its STORED value (here daily_rest block, 26 weeks), never the default; the window may be left out as well
    expect(await w.ok("PUT", "/v1/roster/rules", w.p.owner, { severity: { unavailable: "ignore" } })).toEqual({ severity: { ...good.severity, unavailable: "ignore" }, avgWeekReferenceWeeks: 26 })
    // the setting is per tenant
    expect(await ownerQuery("select 1 from tenant_settings where key = 'roster.rules' and tenant_id <> $1", [w.tenant.id])).toEqual([])
  })

  test("AD4: GET carries an ETag, PUT needs If-Match (428 missing, 412 stale with the current ETag, nothing written), the response carries the new ETag", async () => {
    const w = await sites()
    const put = (who: Who, body: unknown, headers?: Record<string, string>) => call(w.app, "PUT", "/v1/roster/rules", { cookie: w.cookies.get(who.email)!, tenant: "acme", body, headers })
    await w.req("GET", "/v1/roster/rules", w.p.admin)
    const body = { severity: { daily_rest: "block" }, avgWeekReferenceWeeks: 20 }
    const g1 = await w.req("GET", "/v1/roster/rules", w.p.admin)
    const e1 = g1.headers.get("etag")!
    expect(e1).toMatch(/^"[0-9a-f]{32}"$/)
    expect((await w.req("GET", "/v1/roster/rules", w.staff2)).headers.get("etag")).toBe(e1) // same state, same tag for every reader
    const none = await put(w.p.admin, body)
    expect([none.status, ((await none.json()) as Json).code]).toEqual([428, "precondition_required"])
    expect(await w.rows("select 1 from tenant_settings where key = 'roster.rules'")).toEqual([])
    const ok1 = await put(w.p.admin, body, { "if-match": e1 })
    expect(ok1.status).toBe(200)
    const e2 = ok1.headers.get("etag")!
    expect(e2).not.toBe(e1)
    expect((await w.req("GET", "/v1/roster/rules", w.p.admin)).headers.get("etag")).toBe(e2)
    const stale = await put(w.p.owner, { severity: { daily_rest: "warn" }, avgWeekReferenceWeeks: 5 }, { "if-match": e1 })
    expect([stale.status, ((await stale.json()) as Json).code]).toEqual([412, "precondition_failed"])
    expect(stale.headers.get("etag")).toBe(e2)
    expect(await w.ok("GET", "/v1/roster/rules", w.p.owner)).toMatchObject({ severity: { daily_rest: "block" }, avgWeekReferenceWeeks: 20 })
    for (const bad of [`W/${e2}`, "*", "nonsense", `"zz", "yy"`]) expect((await put(w.p.admin, body, { "if-match": bad })).status, bad).toBe(412)
    expect((await put(w.p.admin, body, { "if-match": `"zz", ${e2}` })).status).toBe(200) // a list holding the current tag matches
    // two concurrent PUTs from the same tag: one 200, one 412
    const e3 = (await w.req("GET", "/v1/roster/rules", w.p.admin)).headers.get("etag")!
    const rs = await Promise.all([put(w.p.admin, { severity: { left: "block" } }, { "if-match": e3 }), put(w.p.owner, { severity: { left: "ignore" } }, { "if-match": e3 })])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 412])
    // the ETag follows what the engine reads: a stored ignore on a statutory rule reads as warn (AD5), so the tag is the tag of the normalised settings
    const rules = (await w.rows("select value from tenant_settings where key = 'roster.rules'"))[0].value
    expect(rules.severity.daily_rest).toBe("block")
  })

  test("AD5: ignore is only for non-statutory rules (daily_rest, weekly_rest and avg_48h accept warn|block, 422 invalid_rules); a stored ignore on them reads as warn", async () => {
    const w = await sites()
    for (const r of ["daily_rest", "weekly_rest", "avg_48h"]) {
      expect(await w.code("PUT", "/v1/roster/rules", w.p.admin, { severity: { [r]: "ignore" }, avgWeekReferenceWeeks: 17 }, 422), r).toBe("invalid_rules")
      expect((await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { [r]: "block" }, avgWeekReferenceWeeks: 17 })).severity[r]).toBe("block")
      expect((await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { [r]: "warn" }, avgWeekReferenceWeeks: 17 })).severity[r]).toBe("warn")
    }
    for (const r of ["double_booking", "approved_leave", "unavailable", "expired_licence", "left"]) expect((await w.ok("PUT", "/v1/roster/rules", w.p.admin, { severity: { [r]: "ignore" } })).severity[r], r).toBe("ignore")
    // a value stored before the rule existed (or written by hand) is read as warn for the statutory rules, in GET and in the engine
    await w.rows("update tenant_settings set value = jsonb_set(jsonb_set(value, '{severity,daily_rest}', '\"ignore\"'), '{severity,avg_48h}', '\"ignore\"') where key = 'roster.rules'")
    expect(await w.ok("GET", "/v1/roster/rules", w.p.owner)).toMatchObject({ severity: { daily_rest: "warn", avg_48h: "warn", weekly_rest: "warn" } })
    await w.shift({ loc: w.a, type: w.ta, user: w.p.employee.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON })
    await w.shift({ loc: w.a, type: w.ta, user: w.p.employee.userId, date: "2026-11-03", start: "02:00", end: "10:00", weekStart: MON })
    expect(rule(await w.violations(w.p.owner, await w.week(w.a, MON)), "daily_rest").length).toBeGreaterThan(0)
  })

  test("the rules routes are 403 module_not_entitled without M1A", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps, { slug: "small", subscription: { planId: "starter" } })
    const o = await makeMember(t.deps, tenant.id, "owner")
    const cookie = (await signIn(t.app, o.email, o.password)).cookie
    for (const [m, path, body] of [["GET", "/v1/roster/rules", undefined], ["PUT", "/v1/roster/rules", { severity: {}, avgWeekReferenceWeeks: 17 }], ["POST", `/v1/roster/weeks/${randomUUID()}/check`, undefined]] as const) {
      const r = await call(t.app, m, path, { cookie, tenant: "small", body })
      expect(r.status, `${m} ${path}`).toBe(403)
      expect(((await r.json()) as Json).code).toBe("module_not_entitled")
    }
  })
})

describe("the context loader", () => {
  test("approved leave is returned by the rule context loader (requested, rejected and cancelled are not) and never reaches a caller outside scope", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.ok("PUT", `/v1/members/${staff.userId}/home-location`, w.p.owner, { locationId: w.a })
    const ask = async (from: string, to: string) => (await w.ok("POST", "/v1/leave", staff, { from, to, kind: "annual", note: "" }, 201)).id as string
    const [approved, rejected, open] = [await ask("2026-11-03", "2026-11-03"), await ask("2026-11-04", "2026-11-04"), await ask("2026-11-05", "2026-11-05")]
    await w.ok("POST", `/v1/leave/${approved}/decide`, w.p["location-supervisor"], { decision: "approve", note: "" })
    await w.ok("POST", `/v1/leave/${rejected}/decide`, w.p["location-supervisor"], { decision: "reject", note: "" })
    const cancelled = await ask("2026-11-20", "2026-11-20")
    await w.ok("POST", `/v1/leave/${cancelled}/cancel`, staff)
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const wk = await w.week(w.a, MON)
    const loaded = await w.ctxOf(w.p.admin, async (tx, ctx) => (await loadRuleContext(tx, ctx, { weekIds: [wk], from: MON, to: "2026-11-08" })).leave)
    expect(loaded.map((l) => l.id)).toEqual([approved])
    expect(loaded[0]).toMatchObject({ personId: staff.userId, from: "2026-11-03", to: "2026-11-03", status: "approved" })
    expect(open).toBeTruthy()
    // the violation a cut caller sees carries no dates; a supervisor of another site cannot even reach the week
    const cut = rule(await w.violations(w.p["location-supervisor"], wk), "approved_leave")
    expect(cut).toHaveLength(1)
    expect(cut[0].message).toBe("Aoife Byrne has approved leave on that day")
    expect((await w.check(w.sup2, wk)).status).toBe(404)
    expect((await w.ok("GET", "/v1/leave", w.sup2)).items).toEqual([])
    expect(rule(await w.violations(w.p.admin, wk), "approved_leave")[0].message).toContain("2026-11-03 to 2026-11-03")
  })

  test("loadRuleContext reads every location, public holidays, availability and the tenant zone; a site's own zone is used for its shifts", async () => {
    const w = await sites()
    const staff = w.p.employee
    await w.rows("insert into public_holidays (tenant_id, date, name) values ($1, '2026-12-25', 'Christmas Day'), ($1, '2027-03-17', 'St Patrick''s Day')", [w.tenant.id])
    await w.ok("PUT", "/v1/roster/availability", staff, { windows: [{ weekday: 2, from: "09:00", to: "12:00" }] })
    await w.rows("update locations set time_zone = 'America/New_York' where id = $1", [w.b])
    await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON })
    const hidden = await w.shift({ loc: w.b, type: w.tb, user: staff.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const wk = await w.week(w.a, MON)
    const c = await w.ctxOf(w.p["location-supervisor"], (tx, ctx) => loadRuleContext(tx, ctx, { weekIds: [wk], from: MON, to: "2026-11-08" }))
    expect(c.shifts.map((s) => s.id)).toContain(hidden) // hidden sites still count in rule checks
    expect(c.visibleLocationIds).toEqual([w.a])
    expect(c.zones).toMatchObject({ [w.a]: TZ, [w.b]: "America/New_York" })
    expect(c.availability).toEqual([{ personId: staff.userId, weekday: 2, from: "09:00", to: "12:00" }])
    expect(c.holidays).toEqual([]) // outside the window
    const wide = await w.ctxOf(w.p.admin, (tx, ctx) => loadRuleContext(tx, ctx, { weekIds: [wk], from: "2026-12-21", to: "2027-03-20" }))
    expect(wide.holidays.map((h) => h.date)).toEqual(["2026-12-25", "2027-03-17"])
    expect(wide.visibleLocationIds).toBeNull() // an office role that sees every site
    expect(wide.severity).toEqual(DEFAULT_SEVERITY)
    expect(wide.avgWeekReferenceWeeks).toBe(17)
    expect(wide.members.find((m) => m.id === staff.userId)).toMatchObject({ name: "Aoife Byrne", homeLocationId: null, leftOn: null, qualifications: [] })
  })

  test("checkWeek drops shifts and adds proposed ones for a dry run (nothing written); a proposed shift is checked against the person's other sites", async () => {
    const w = await sites()
    const staff = w.p.employee
    const keep = await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "08:00", end: "16:00", weekStart: MON })
    const clash = await w.shift({ loc: w.a, type: w.ta, user: staff.userId, date: MON, start: "12:00", end: "20:00", weekStart: MON })
    const elsewhere = await w.shift({ loc: w.b, type: w.tb, user: w.staff2.userId, date: "2026-11-03", start: "08:00", end: "16:00", weekStart: MON })
    const wk = await w.week(w.a, MON)
    const base = await w.ctxOf(w.p.admin, (tx, ctx) => checkWeek(tx, ctx, wk))
    expect(rule(base, "double_booking").map((v) => v.shiftId).sort()).toEqual([keep, clash].sort())
    const dropped = await w.ctxOf(w.p.admin, (tx, ctx) => checkWeek(tx, ctx, wk, { dropShiftIds: [clash] }))
    expect(rule(dropped, "double_booking")).toEqual([])
    // proposing staff2 at Alpha on top of their Bravo shift of the same time is a clash, found through the person's other site
    const added = await w.ctxOf(w.p.admin, (tx, ctx) => checkWeek(tx, ctx, wk, { dropShiftIds: [clash], add: [{ id: "new-1", date: "2026-11-03", personId: w.staff2.userId, shiftTypeId: w.ta }] }))
    const hit = rule(added, "double_booking").filter((v) => v.shiftId === "new-1")
    expect(hit).toHaveLength(1)
    expect(hit[0].otherShiftIds).toEqual([elsewhere])
    expect(await w.rows("select count(*)::int n from roster_shifts")).toEqual([{ n: 3 }])
  })

  test("context loader is bounded: a 4-week window with 1 000 shifts runs 6 queries or fewer (query counter)", async () => {
    const w = await sites()
    const people = [w.p.employee, w.staff2, w.p.manager, w.p.admin, w.p["roster-manager"], w.p.owner]
    const weekIds: string[] = []
    for (const ws of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) weekIds.push(await w.week(w.a, ws))
    await w.rows(
      `insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at)
       select $1, ($2::uuid[])[1 + ((g % 28) / 7)], $3, ('2026-11-02'::date + (g % 28)), ($4::text[])[1 + (g % 6)], $5, 'Guard',
              lpad(((g / 28) % 22)::text, 2, '0') || ':00', lpad((((g / 28) % 22) + 1)::text, 2, '0') || ':00',
              ('2026-11-02'::timestamptz + make_interval(days => g % 28, hours => (g / 28) % 22)), ('2026-11-02'::timestamptz + make_interval(days => g % 28, hours => ((g / 28) % 22) + 1)), now(), now()
         from generate_series(0, 999) g`,
      [w.tenant.id, weekIds, w.a, people.map((x) => x.userId), w.ta],
    )
    expect(await w.rows("select count(*)::int n from roster_shifts")).toEqual([{ n: 1000 }])
    await w.rows("insert into member_qualifications (tenant_id, user_id, type, expires_on, created_at, updated_at) values ($1, $2, 'first aid', '2027-01-01', now(), now())", [w.tenant.id, w.p.employee.userId])
    let queries = 0
    const counted = (tx: TenantTx): TenantTx =>
      new Proxy(tx, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv)
          return typeof v === "function" && ["select", "execute", "insert", "update", "delete"].includes(String(prop)) ? (...a: unknown[]) => (queries++, v.apply(target, a)) : typeof v === "function" ? v.bind(target) : v
        },
      })
    const ctx = await w.ctxOf(w.p.admin, (tx, rc) => loadRuleContext(tx, rc, { weekIds, from: "2026-11-02", to: "2026-11-29" }), { wrap: counted })
    expect(ctx.shifts).toHaveLength(1000)
    expect(ctx.members.length).toBe(6)
    expect(queries).toBeLessThanOrEqual(6)
    expect(queries).toBeGreaterThan(0)
    // and the whole check endpoint over that week stays fast and answers
    const res = await w.check(w.p.admin, weekIds[0])
    expect(res.status).toBe(200)
  }, 60_000)
})

describe("source rules", () => {
  test("the rule engine reads the clock only through deps (no new Date() or Date.now() in rosters)", () => {
    for (const f of ["rules.ts", "leave.ts"]) expect(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).not.toMatch(/new Date\(\)|Date\.now\(\)/)
  })
})
