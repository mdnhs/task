import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { clearModuleOverride } from "../entitlements"
import { registerFiles } from "../files"
import { registerGdpr } from "../gdpr"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerWebhooks } from "../webhooks-out"
import { DEADLINE_JOB, runDeadlineJob } from "./alerts"
import { world, type Json, type Who, type W } from "./world"
import { registerShiftReports } from "."

// T5.4: the deadline job (shift-reports.deadline): the shift-end prompt and the "missing at deadline" alert. Rulings F2, F3, F12, F13, F19, C13, C14, E13.
// The two nights: Sat 24 Oct 2026 22:00-06:00 Dublin lasts 9 h (end 06:00Z, due 07:00Z, report day 24 Oct); Sat 27 Mar 2027 lasts 7 h (end 05:00Z, due 06:00Z).

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
  registerGdpr()
  registerWebhooks()
})
afterEach(resetSubscribers)

const MISSING = "Shift report missing"
const PROMPT = "Shift report due"
const iso = (d: unknown) => (d as Date).toISOString()
const dbCode = (e: unknown) => (e as { cause?: { code?: string } })?.cause?.code

/** The fake clock only moves forward: jump to `at`. */
function setClock(w: W, at: string): void {
  const d = Date.parse(at) - w.clock.now().getTime()
  if (d < 0) throw new Error(`the clock cannot go back to ${at}`)
  w.clock.advance({ minutes: d / 60_000 })
}
/** A logger that records every line (the job must log ids and safe codes only). */
function spy() {
  const lines: Json[] = []
  const mk = (level: string) => (o: unknown, m?: string) => void lines.push({ level, ...(o && typeof o === "object" ? (o as Json) : {}), msg: m ?? (typeof o === "string" ? o : undefined) })
  const l = { error: mk("error"), warn: mk("warn"), info: mk("info"), debug: mk("debug"), trace: mk("trace"), fatal: mk("fatal"), level: "debug" } as Json
  l.child = () => l
  return { logger: l as unknown as Deps["logger"], lines }
}
const run = (w: W, logger?: Deps["logger"], workers = 1) => Promise.all(Array.from({ length: workers }, () => runDeadlineJob({}, logger ? { ...w.deps, logger } : w.deps)))
/** Sets the clock and runs the job (`workers` of them in parallel). */
async function tick(w: W, at: string, workers = 1, logger?: Deps["logger"]): Promise<void> {
  setClock(w, at)
  await run(w, logger, workers)
}
/** Steps the clock every `stepMin` minutes from `from` to `to` (inclusive), one job tick each. */
async function walk(w: W, from: string, to: string, stepMin: number, workers = 1, logger?: Deps["logger"]): Promise<void> {
  for (let t = Date.parse(from); t <= Date.parse(to); t += stepMin * 60_000) await tick(w, new Date(t).toISOString(), workers, logger)
}
const ledger = (w: W, where = "true") => w.q(`select user_id, pattern_id, shift_date::text d, kind, alerted_at from shift_report_alerts where ${where} order by alerted_at, shift_date, kind, user_id`)
const notes = (w: W, title?: string) =>
  w.q(`select user_id, title, body, subject_user_id, created_at from notifications where kind = 'report' ${title ? `and title = '${title}'` : "and title in ('Shift report due', 'Shift report missing')"} order by created_at, user_id, body`)
/** Only the shifts that start on or after `from` exist (the world assigns everyone from 1 Oct): keeps a test about one night free of older nights. */
const onlyFrom = (w: W, from: string) => w.q("update shift_assignments set from_date = $1", [from])
/** Only these members work the night pattern. */
const onlyOn = (w: W, ...who: Who[]) => w.q("delete from shift_assignments where user_id <> all($1::text[])", [who.map((u) => u.userId)])
const byKind = (rows: Json[], kind: string) => rows.filter((r) => r.kind === kind)
const uniq = (a: string[]) => a.filter((v, i) => a.indexOf(v) === i)

/** A second tenant on the same app and clock: its own team, a 22:00-06:00 pattern, two staff, reporting on. */
async function extraTenant(w: W, slug: string, tz: string, o: { from?: string } = {}) {
  const tenant = await makeTenant(w.deps, { slug, sessionIdleHours: 2160 })
  await ownerQuery("update tenants set timezone = $1 where id = $2", [tz, tenant.id])
  const mk = async (role: string): Promise<Who> => {
    const m = await makeMember(w.deps, tenant.id, role)
    return { userId: m.userId, email: m.email, password: m.password, cookie: (await signIn(w.app, m.email, m.password)).cookie }
  }
  const owner = await mk("owner")
  const ops = await mk("ops")
  const a = await mk("employee")
  const b = await mk("employee")
  const rq = (method: string, path: string, as: Who, body?: unknown) => call(w.app, method, path, { cookie: as.cookie, tenant: slug, body })
  const team = ((await (await rq("POST", "/v1/teams", owner, { name: "Night team", kind: "team" })).json()) as Json).id as string
  const pr = await rq("POST", "/v1/shifts/patterns", ops, { name: "Night", teamId: team, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6] })
  expect(pr.status, await pr.clone().text()).toBe(201)
  const pattern = ((await pr.json()) as Json).id as string
  for (const u of [a, b]) expect((await rq("POST", "/v1/shifts/assignments", ops, { userId: u.userId, patternId: pattern, from: o.from ?? "2026-10-24" })).status).toBe(201)
  expect((await rq("PUT", `/v1/shifts/reporting/teams/${team}`, ops, { on: true })).status).toBe(200)
  const q = <R = Json>(text: string, params: unknown[] = []) => ownerTenantQuery(tenant.id, text, params) as Promise<R[]>
  return { tenant, owner, ops, a, b, team, pattern, q }
}

describe("the deadline across the DST changes (Review Focus #1)", () => {
  test("Sat 24 Oct 2026 night (22:00-06:00 Dublin, 9 h): the prompt comes at 06:00Z and 'missing' at 07:00Z, not at 06:00Z or 05:00Z; the report day is 24 Oct", async () => {
    const w = await world({ now: "2026-10-25T04:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await walk(w, "2026-10-25T04:00:00Z", "2026-10-25T08:00:00Z", 5)
    const rows = await ledger(w)
    expect(rows.every((r) => r.d === "2026-10-24")).toBe(true)
    expect(uniq(rows.map((r) => `${r.kind}@${iso(r.alerted_at)}`))).toEqual(["prompt@2026-10-25T06:00:00.000Z", "missing@2026-10-25T07:00:00.000Z"])
    expect(byKind(rows, "prompt").map((r) => r.user_id).sort()).toEqual([w.staff.userId, w.staff2.userId, w.staff3.userId, w.owner.userId].sort())
    expect(byKind(rows, "missing")).toHaveLength(4)
  })

  test("March night (Sat 27 Mar 2027, 7 h): prompt at 05:00Z and missing at 06:00Z; Sun 25 Oct night (a normal 8 h): prompt 06:00Z next day, missing 07:00Z", async () => {
    const w = await world({ now: "2027-03-28T03:00:00.000Z" })
    await onlyFrom(w, "2027-03-27")
    await walk(w, "2027-03-28T03:00:00Z", "2027-03-28T07:00:00Z", 5)
    expect(uniq((await ledger(w)).map((r) => `${r.d}|${r.kind}@${iso(r.alerted_at)}`))).toEqual(["2027-03-27|prompt@2027-03-28T05:00:00.000Z", "2027-03-27|missing@2027-03-28T06:00:00.000Z"])

    const x = await world({ now: "2026-10-26T04:00:00.000Z", slug: "oct" })
    await onlyFrom(x, "2026-10-25")
    await walk(x, "2026-10-26T04:00:00Z", "2026-10-26T08:00:00Z", 5)
    expect(uniq((await ledger(x)).map((r) => `${r.d}|${r.kind}@${iso(r.alerted_at)}`))).toEqual(["2026-10-25|prompt@2026-10-26T06:00:00.000Z", "2026-10-25|missing@2026-10-26T07:00:00.000Z"])
  }, 60_000)

  test("two workers and the repeated hour send each alert exactly once: shift 18:00-01:30 on 24 Oct, clock stepped 5 min from 23:00Z to 04:00Z, two jobs in parallel per tick → one prompt (00:30Z) and one missing (01:30Z) per member and manager", async () => {
    const w = await world({ now: "2026-10-24T23:00:00.000Z" })
    const pr = await w.req("POST", "/v1/shifts/patterns", w.ops, { name: "Late", teamId: w.team, start: "18:00", end: "01:30", days: [0, 1, 2, 3, 4, 5, 6] })
    expect(pr.status, await pr.clone().text()).toBe(201)
    const late = (await w.json(pr)).id as string
    await w.q("delete from shift_assignments")
    for (const u of [w.staff, w.staff2]) expect((await w.req("POST", "/v1/shifts/assignments", w.ops, { userId: u.userId, patternId: late, from: "2026-10-24" })).status).toBe(201)
    await w.manages(w.manager, w.staff) // staff2 has no manager: the owner is told
    const s = spy()
    await walk(w, "2026-10-24T23:00:00Z", "2026-10-25T04:00:00Z", 5, 2, s.logger)
    expect(s.lines.filter((l) => l.level === "error")).toEqual([]) // no deadlock, no unique-violation noise
    const rows = await ledger(w)
    expect(rows.map((r) => `${r.user_id === w.staff.userId ? "staff" : "staff2"}|${r.d}|${r.kind}@${iso(r.alerted_at)}`).sort()).toEqual([
      "staff|2026-10-24|missing@2026-10-25T01:30:00.000Z", "staff|2026-10-24|prompt@2026-10-25T00:30:00.000Z",
      "staff2|2026-10-24|missing@2026-10-25T01:30:00.000Z", "staff2|2026-10-24|prompt@2026-10-25T00:30:00.000Z",
    ].sort())
    const n = await notes(w)
    expect(n.filter((r) => r.title === PROMPT).map((r) => r.user_id).sort()).toEqual([w.staff.userId, w.staff2.userId].sort())
    expect(n.filter((r) => r.title === MISSING).map((r) => `${r.user_id}|${r.subject_user_id}`).sort()).toEqual(
      [`${w.staff.userId}|null`, `${w.staff2.userId}|null`, `${w.manager.userId}|${w.staff.userId}`, `${w.owner.userId}|${w.staff2.userId}`].sort(),
    )
    expect(n).toHaveLength(6) // 2 prompts + 4 missing: nothing twice
  }, 120_000)

  test("six workers at the very same instant still produce one alert per (member, shift, day, kind) and one notification per recipient, with no error logged", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    const s = spy()
    await tick(w, "2026-10-25T07:00:00Z", 6, s.logger)
    expect(s.lines.filter((l) => l.level === "error")).toEqual([])
    expect(await ledger(w)).toHaveLength(4) // missing for staff, staff2, staff3, owner (the prompt window is over)
    const n = await notes(w)
    expect(n.map((r) => `${r.user_id}|${r.title}|${r.subject_user_id}`).sort()).toEqual(
      [
        `${w.staff.userId}|${MISSING}|null`, `${w.staff2.userId}|${MISSING}|null`, `${w.staff3.userId}|${MISSING}|null`, `${w.owner.userId}|${MISSING}|null`,
        `${w.owner.userId}|${MISSING}|${w.staff.userId}`, `${w.owner.userId}|${MISSING}|${w.staff2.userId}`, `${w.owner.userId}|${MISSING}|${w.staff3.userId}`,
      ].sort(),
    )
  })
})

describe("exactly once and all-or-nothing", () => {
  test("a retried job after a crash between tenants repeats nothing: a tenant that fails is logged (ids and a code only), the other tenant is alerted, and the rerun adds only what is missing", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    const other = await extraTenant(w, "bravo", "Europe/Dublin")
    await ownerQuery("update tenants set timezone = 'Mars/Phobos' where id = $1", [w.tenant.id])
    const s = spy()
    await tick(w, "2026-10-25T07:00:00Z", 1, s.logger)
    expect(await ledger(w)).toHaveLength(0)
    expect(await other.q("select kind from shift_report_alerts")).toHaveLength(2) // tenant 2 was not stopped by tenant 1
    const err = s.lines.filter((l) => l.level === "error")
    expect(err).toHaveLength(1)
    expect(err[0]).toMatchObject({ tenantId: w.tenant.id, errCode: "RangeError" })
    expect(JSON.stringify(s.lines)).not.toMatch(/Mars|Phobos|@|summary/)
    await ownerQuery("update tenants set timezone = 'Europe/Dublin' where id = $1", [w.tenant.id])
    await tick(w, "2026-10-25T07:05:00Z", 2)
    expect(await ledger(w)).toHaveLength(4)
    expect(await other.q("select kind from shift_report_alerts")).toHaveLength(2) // nothing repeated
    expect((await other.q("select 1 from notifications where kind = 'report'")).length).toBe(4) // 2 members + the owner as the manager fallback for each
  })

  test("the ledger row and its notifications are atomic: a failing notification rolls the ledger back (nothing half-sent), the next tick sends everything once, a third sends nothing", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyOn(w, w.staff)
    await onlyFrom(w, "2026-10-24")
    await w.manages(w.manager, w.staff)
    await ownerQuery(`create function t54_boom() returns trigger language plpgsql as $$ begin if new.user_id = '${w.manager.userId}' then raise exception 'boom'; end if; return new; end $$`)
    await ownerQuery("create trigger t54_boom before insert on notifications for each row execute function t54_boom()")
    try {
      const s = spy()
      await tick(w, "2026-10-25T07:00:00Z", 1, s.logger)
      expect(await ledger(w)).toHaveLength(0) // the member's notification was written first, then the manager's failed: all rolled back
      expect(await notes(w)).toHaveLength(0)
      expect(s.lines.filter((l) => l.level === "error")).toHaveLength(1)
    } finally {
      await ownerQuery("drop trigger t54_boom on notifications")
      await ownerQuery("drop function t54_boom()")
    }
    await tick(w, "2026-10-25T07:05:00Z", 2)
    expect((await ledger(w)).map((r) => r.kind)).toEqual(["missing"])
    expect((await notes(w)).map((r) => `${r.user_id}|${r.subject_user_id}`).sort()).toEqual([`${w.staff.userId}|null`, `${w.manager.userId}|${w.staff.userId}`].sort())
    await tick(w, "2026-10-25T07:10:00Z", 2)
    expect(await ledger(w)).toHaveLength(1)
    expect(await notes(w)).toHaveLength(2)
  })

  test("a report submitted before the due time (even one returned and not resubmitted) means no 'missing'; one submitted after the alert is 'late' and sends nothing more; the prompt stops once it is submitted", async () => {
    const w = await world({ now: "2026-10-25T06:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await w.task(w.staff)
    await w.task(w.staff2)
    await w.task(w.staff3)
    await tick(w, "2026-10-25T06:00:00Z") // the prompt goes to all four
    expect(byKind(await ledger(w), "prompt")).toHaveLength(4)
    setClock(w, "2026-10-25T06:10:00Z")
    const subs: Json[] = []
    for (const u of [w.staff, w.staff3]) {
      const sub = await w.submit(u, await w.filled(u, await w.opened(u)))
      expect(sub.status, await sub.clone().text()).toBe(200)
      subs.push(await w.json(sub))
    }
    const ret = await w.req("POST", `/v1/shift-reports/${subs[1].id}/return`, w.ops, { version: subs[1].version, comment: "Please add the lift fault" })
    expect(ret.status, await ret.clone().text()).toBe(200) // staff3's report is now "returned" and stays that way
    await walk(w, "2026-10-25T06:15:00Z", "2026-10-25T07:30:00Z", 5)
    expect(byKind(await ledger(w), "missing").map((r) => r.user_id).sort()).toEqual([w.staff2.userId, w.owner.userId].sort()) // staff (on time) and staff3 (returned) were never missing
    const late = await w.submit(w.staff2, await w.filled(w.staff2, await w.opened(w.staff2)))
    expect(late.status, await late.clone().text()).toBe(200)
    const before = (await notes(w)).length
    await walk(w, "2026-10-25T07:35:00Z", "2026-10-25T09:00:00Z", 5, 2)
    expect((await notes(w)).length).toBe(before) // the alert is not retracted, and nothing repeats
    expect(await ledger(w)).toHaveLength(4 + 2)
  }, 120_000)

  test("a stored report keeps its own due instant (F3): a pattern edit after the member opened it moves only the shifts nobody saved yet", async () => {
    const w = await world({ now: "2026-10-25T05:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await onlyOn(w, w.staff, w.staff2)
    await w.opened(w.staff) // snapshot: due 07:00Z
    await w.q("update shift_patterns set end_time = '07:00'") // an edit: the night now ends 07:00 (07:00Z) and is due 08:00Z for shifts without a saved report
    await tick(w, "2026-10-25T07:00:00Z")
    expect((await ledger(w, "kind = 'missing'")).map((r) => r.user_id)).toEqual([w.staff.userId])
  })
})

describe("who is told", () => {
  test("the member and the primary manager both get 'missing'; with no manager the active owners do (a suspended owner does not); the manager body holds no name ({{subject}})", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    const owner2 = await w.who("owner")
    const owner3 = await w.who("owner")
    await w.q("update memberships set status = 'suspended' where user_id = $1", [owner3.userId])
    await onlyOn(w, w.staff, w.staff2)
    await onlyFrom(w, "2026-10-24")
    await w.manages(w.manager, w.staff)
    await tick(w, "2026-10-25T07:00:00Z")
    const n = await notes(w, MISSING)
    expect(n.map((r) => `${r.user_id}|${r.subject_user_id}`).sort()).toEqual(
      [`${w.staff.userId}|null`, `${w.manager.userId}|${w.staff.userId}`, `${w.staff2.userId}|null`, `${w.owner.userId}|${w.staff2.userId}`, `${owner2.userId}|${w.staff2.userId}`].sort(),
    )
    expect(n.find((r) => r.user_id === w.manager.userId)!.body).toBe("{{subject}}: Night, 2026-10-24. Was due 07:00")
    const names = (await ownerQuery(`select name from "user" where id = any($1::text[])`, [[w.staff.userId, w.staff2.userId]])).map((r) => String(r.name))
    for (const r of n) for (const name of names) expect(String(r.body)).not.toContain(name)
    expect(n.find((r) => r.user_id === w.staff.userId)!.body).toBe("Night, 2026-10-24. Was due 07:00")
  })

  test("a suspended manager is skipped: the owners are told instead; a suspended or removed member gets nothing", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await w.manages(w.manager, w.staff)
    await w.manages(w.manager, w.staff2)
    await w.manages(w.manager, w.staff3)
    await w.q("update memberships set status = 'suspended' where user_id = any($1::text[])", [[w.manager.userId, w.staff2.userId]])
    await w.q("delete from memberships where user_id = $1", [w.staff3.userId]) // removed
    await tick(w, "2026-10-25T07:00:00Z")
    const n = await notes(w, MISSING)
    const users = new Set(n.map((r) => r.user_id))
    for (const u of [w.manager, w.staff2, w.staff3]) expect(users.has(u.userId)).toBe(false)
    // staff and the owner (a member too); the owner also hears staff's as the manager fallback
    expect(n.map((r) => `${r.user_id}|${r.subject_user_id}`).sort()).toEqual([`${w.staff.userId}|null`, `${w.owner.userId}|null`, `${w.owner.userId}|${w.staff.userId}`].sort())
    expect((await ledger(w)).map((r) => r.user_id).sort()).toEqual([w.owner.userId, w.staff.userId].sort())
  })

  test("reporting turned off after the shift ended sends nothing; a person's own override beats the team default either way (T5.1 precedence)", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    expect((await w.req("PUT", `/v1/shifts/reporting/teams/${w.team}`, w.ops, { on: false })).status).toBe(200) // after the shift ended
    expect((await w.req("PUT", `/v1/shifts/reporting/people/${w.staff.userId}`, w.ops, { on: true })).status).toBe(200)
    await tick(w, "2026-10-25T07:00:00Z")
    expect((await ledger(w)).map((r) => r.user_id)).toEqual([w.staff.userId])
    const w2 = await world({ now: "2026-10-25T07:00:00.000Z", slug: "two" })
    await onlyFrom(w2, "2026-10-24")
    expect((await w2.req("PUT", `/v1/shifts/reporting/people/${w2.staff2.userId}`, w2.ops, { on: false })).status).toBe(200)
    await tick(w2, "2026-10-25T07:00:00Z")
    expect((await ledger(w2)).map((r) => r.user_id).sort()).toEqual([w2.staff.userId, w2.staff3.userId, w2.owner.userId].sort())
  })

  test("the due-after setting (90 min) shifts the instant: no 'missing' at 07:00Z or 07:25Z, one at 07:30Z; the prompt runs until then", async () => {
    const w = await world({ now: "2026-10-25T06:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    const p = await w.req("PATCH", "/v1/settings/organisation", w.owner, { reportDueAfterMinutes: 90 })
    expect(p.status, await p.clone().text()).toBe(200)
    await walk(w, "2026-10-25T06:00:00Z", "2026-10-25T07:25:00Z", 5)
    expect(byKind(await ledger(w), "missing")).toHaveLength(0)
    expect(byKind(await ledger(w), "prompt")).toHaveLength(4)
    await tick(w, "2026-10-25T07:30:00Z")
    expect(byKind(await ledger(w), "missing").map((r) => iso(r.alerted_at))).toEqual(Array(4).fill("2026-10-25T07:30:00.000Z"))
  })

  test("notification text carries the shift name and date only (Drive-redacted), never report content; the prompt reads '<shift>, <date>. Due HH:mm'", async () => {
    const w = await world({ now: "2026-10-25T06:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await onlyOn(w, w.staff)
    await w.q("update shift_patterns set name = $1", ["Night https://drive.google.com/file/d/abc123/view"])
    await w.task(w.staff)
    await w.saved(w.staff, await w.opened(w.staff), { summary: "SECRET-SUMMARY-TEXT" })
    await tick(w, "2026-10-25T06:00:00Z")
    await tick(w, "2026-10-25T07:00:00Z")
    const n = await notes(w)
    expect(n).toHaveLength(3) // the member's prompt and missing, and the owner's (manager fallback) missing
    for (const r of n) {
      expect(String(r.body)).not.toContain("drive.google.com")
      expect(String(r.body)).not.toContain("SECRET")
      expect(String(r.body)).toContain("Google Drive link")
    }
    expect(n.find((r) => r.title === PROMPT)!.body).toMatch(/, 2026-10-24\. Due 07:00$/)
    expect(n.filter((r) => r.title === MISSING).map((r) => String(r.body).startsWith("{{subject}}: ")).sort()).toEqual([false, true])
  })
})

describe("the 48 h lookback and the tenant gate", () => {
  test("lookback is 48 h: a shift whose due time is 49 h old is not alerted (logged) and still shows 'missing' in the inbox; 47 h 59 min is alerted", async () => {
    const w = await world({ now: "2026-10-27T08:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await onlyOn(w, w.staff)
    const s = spy()
    await tick(w, "2026-10-27T08:00:00Z", 1, s.logger) // the 24 Oct night was due 25 Oct 07:00Z = 49 h ago
    expect(uniq((await ledger(w)).map((r) => r.d))).toEqual(["2026-10-25", "2026-10-26"]) // due 26 Oct 07:00Z (25 h) and 27 Oct 07:00Z (1 h)
    const inbox = await w.json(await w.req("GET", "/v1/shift-reports?from=2026-10-24&to=2026-10-24&status=missing", w.ops))
    expect(inbox.items.map((i: Json) => [i.userId, i.state])).toEqual([[w.staff.userId, "missing"]])
    const logged = s.lines.find((l) => l.tenantId === w.tenant.id && typeof l.count === "number")
    expect(logged).toMatchObject({ tenantId: w.tenant.id, count: 1 }) // outside the window: logged with the tenant id and a count only
    expect(JSON.stringify(s.lines)).not.toContain(w.staff.userId)
    const x = await world({ now: "2026-10-27T06:59:00.000Z", slug: "edge" })
    await onlyFrom(x, "2026-10-24")
    await onlyOn(x, x.staff)
    await tick(x, "2026-10-27T06:59:00Z")
    expect((await ledger(x, "shift_date = '2026-10-24'")).map((r) => r.kind)).toEqual(["missing"]) // 47 h 59 min old
  })

  test("job skips suspended tenants (C14), tenants without M1 and billing-blocked tenants (C13), keeps their data; re-enabling resumes with the last 48 h only (no flood)", async () => {
    const w = await world({ now: "2026-10-28T07:00:00.000Z" }) // assigned from 1 Oct: 28 nights, only those due in the last 48 h may be alerted
    const keep = async () => ({ assignments: (await w.q("select count(*)::int n from shift_assignments"))[0].n, reporting: (await w.q("select count(*)::int n from shift_reporting_teams"))[0].n })
    const data = await keep()
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [w.tenant.id])
    await tick(w, "2026-10-28T07:00:00Z")
    expect(await ledger(w)).toHaveLength(0)
    await ownerQuery("update tenants set status = 'active' where id = $1", [w.tenant.id])
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await tick(w, "2026-10-28T07:05:00Z")
    expect(await ledger(w)).toHaveLength(0)
    await clearModuleOverride(w.deps, w.tenant.id, w.owner.userId, "M1")
    await tick(w, "2026-10-28T07:10:00Z")
    const rows = await ledger(w)
    expect(uniq(rows.map((r) => r.d)).sort()).toEqual(["2026-10-26", "2026-10-27"]) // the 25 Oct night (due 26 Oct 07:00Z) is outside the window; older ones were never alerted
    expect(rows).toHaveLength(8)
    await w.q("update subscriptions set status = 'canceled' where tenant_id = $1", [w.tenant.id])
    await tick(w, "2026-10-29T08:00:00Z")
    expect(await ledger(w)).toHaveLength(8) // blocked: nothing new
    expect(await keep()).toEqual(data) // data kept throughout
  })

  test("two time zones in one run: Dublin and Auckland tenants each alert at their own due instant (Auckland 24 Oct night is due 18:00Z on the 24th, Dublin 07:00Z on the 25th)", async () => {
    const w = await world({ now: "2026-10-24T16:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    const kiwi = await extraTenant(w, "kiwi", "Pacific/Auckland")
    await walk(w, "2026-10-24T16:00:00Z", "2026-10-25T08:00:00Z", 15, 2)
    const at = (rows: Json[]) => uniq(rows.map((r) => `${r.kind}@${iso(r.alerted_at)}`))
    expect(at(await ledger(w))).toEqual(["prompt@2026-10-25T06:00:00.000Z", "missing@2026-10-25T07:00:00.000Z"])
    expect(at(await kiwi.q("select kind, alerted_at from shift_report_alerts order by alerted_at, kind"))).toEqual(["prompt@2026-10-24T17:00:00.000Z", "missing@2026-10-24T18:00:00.000Z"])
  }, 120_000)
})

describe("the clock, the queue and the database", () => {
  test("the job uses deps.clock only: ledger and notification times are the fake clock's, the source has no new Date() / Date.now() / SQL now(), the worker registers the job, and enqueued job ids have no ':'", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await runJob(DEADLINE_JOB, {}, w.deps) // registered by registerShiftReports
    const rows = await ledger(w)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => iso(r.alerted_at) === "2026-10-25T07:00:00.000Z")).toBe(true)
    const n = await notes(w)
    expect(n.length).toBeGreaterThan(0)
    expect(n.every((r) => iso(r.created_at) === "2026-10-25T07:00:00.000Z")).toBe(true)
    const src = readFileSync(new URL("./alerts.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(/)
    expect(src).not.toMatch(/(^|[^.\w])now\(\)/m)
    for (const j of w.queue.jobs) expect(j.opts?.jobId ?? "").not.toContain(":")
    const worker = readFileSync(new URL("../../worker.ts", import.meta.url), "utf8")
    expect(worker).toMatch(/upsertJobScheduler\(DEADLINE_JOB, \{ every: 5 \* 60_000 \}/)
  })

  test("RLS and grants: the app role can only SELECT and INSERT shift_report_alerts (no UPDATE, no DELETE, no column grants); a tenant-A tx cannot insert tenant-B rows; the key is unique; a foreign pattern is refused; the table is FORCEd; erasure cascades", async () => {
    const w = await world({ now: "2026-10-25T07:00:00.000Z" })
    await onlyFrom(w, "2026-10-24")
    await tick(w, "2026-10-25T07:00:00Z")
    const tbl = (await ownerQuery("select privilege_type from information_schema.role_table_grants where grantee = 'app_user' and table_name = 'shift_report_alerts' order by 1")).map((r) => r.privilege_type)
    expect(tbl).toEqual(["INSERT", "SELECT"])
    expect(await ownerQuery("select column_name from information_schema.column_privileges where grantee = 'app_user' and table_name = 'shift_report_alerts' and privilege_type in ('UPDATE','DELETE')")).toEqual([])
    expect((await ownerQuery("select relforcerowsecurity f, relrowsecurity r from pg_class where relname = 'shift_report_alerts'"))[0]).toEqual({ f: true, r: true })
    for (const stmt of [sql`update shift_report_alerts set kind = 'prompt'`, sql`update shift_report_alerts set alerted_at = alerted_at`, sql`delete from shift_report_alerts`]) {
      const err = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(stmt)).catch((e) => e)
      expect(dbCode(err), String(stmt)).toBe("42501")
    }
    const other = await makeTenant(w.deps, { slug: "bravo" })
    const row = (await ledger(w))[0]
    const insert = (tenantId: string, pattern: string, kind = "prompt") =>
      sql`insert into shift_report_alerts (tenant_id, user_id, pattern_id, shift_date, kind, alerted_at) values (${tenantId}, ${row.user_id}, ${pattern}, '2026-10-20', ${kind}, ${new Date()})`
    expect(dbCode(await withTenant(w.deps.db, other.id, (tx) => tx.execute(insert(w.tenant.id, row.pattern_id))).catch((e) => e))).toBe("42501") // RLS WITH CHECK
    expect((await withTenant(w.deps.db, other.id, (tx) => tx.execute(sql`select 1 from shift_report_alerts`))).rows).toHaveLength(0)
    const dup = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(sql`insert into shift_report_alerts (tenant_id, user_id, pattern_id, shift_date, kind, alerted_at) values (${w.tenant.id}, ${row.user_id}, ${row.pattern_id}, ${row.d}, ${row.kind}, ${new Date()})`)).catch((e) => e)
    expect(dbCode(dup)).toBe("23505")
    expect(dbCode(await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(insert(w.tenant.id, "00000000-0000-4000-8000-000000000001"))).catch((e) => e))).toBe("23503")
    expect(dbCode(await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(insert(w.tenant.id, row.pattern_id, "nag"))).catch((e) => e))).toBe("23514")
    // erasure (F22): the ledger rows leave with the membership (member FK, ON DELETE CASCADE as the owner), although the app role cannot delete them
    await w.q("delete from memberships where user_id = $1", [row.user_id])
    expect(await ledger(w, `user_id = '${row.user_id}'`)).toEqual([])
  })
})
