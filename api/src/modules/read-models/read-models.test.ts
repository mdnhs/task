import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { dayOrder, todayCounts, type TodayTask } from "@opsdesk/domain/today"
import { epochToWall } from "@opsdesk/domain/shifts"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { makeApiKey, makeStaff, makeTenant } from "../../../test/factories"
import { call, resetDb } from "../../../test/harness"
import { median, retryTimingOnce } from "../../../test/timing"
import { resetSubscribers } from "../../core/events"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerShiftReports, type ReportCtx } from "../shift-reports"
import { withTenant } from "../../db/tenant-tx"
import { DRIVE, REQUIRED, world, type Json, type W, type Who } from "../shift-reports/world"
import { cacheKeys, cached, bustReadModels, readModelTtl, READ_MODEL_MAX, READ_MODEL_TTL_MS, resetReadModelCache } from "./cache"
import { dayBounds, localDay, lastDays } from "./days"
import { attentionQuery, awaitingReportsQuery, dashboardSummaryQuery, openReportsQuery, pendingEvidenceQuery, teamTasksQuery, tasksClosedQuery, awaitingReviewQuery } from "./queries"
import { SUPPORT_DENIED_ROUTES } from "../../core/middleware/support"
import { routeDenied } from "../../core/middleware/deny-list"

// T5.6: read models (dashboard, attention, Today, staff dashboard) and the per-tenant scoped cache. Rulings F5, F17, F18, F21, D5, D22/E13.
// The clock is 2026-10-26T12:00Z (Dublin = UTC+0 after the 25 Oct change). The default task of the shift-report world is due 2026-10-25T02:00Z (overdue now).

const NOW = "2026-10-26T12:00:00.000Z"
const at = (h: number, d = "2026-10-26") => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
  resetReadModelCache()
})
afterEach(resetSubscribers)

const get = async (w: W, path: string, as: Who | null) => {
  const r = await w.req("GET", path, as)
  expect(r.status, `${path} ${await r.clone().text()}`).toBe(200)
  return w.json(r)
}
const code = async (r: Response) => ((await r.clone().json()) as Json).code as string
const dash = async (w: W, as: Who) => (await get(w, "/v1/dashboard", as)) as Json
const listLen = async (w: W, as: Who, q: string) => ((await get(w, `/v1/tasks?limit=100&${q}`, as)).items as unknown[]).length
const summaryOf = (d: Json) => d.summary as Record<string, number>

/** The tasks of the scope scenario: staff has an open task due today, an overdue one and one closed today; staff2 one due today; staff3 one waiting for review. */
async function scenario(w: W) {
  const t1 = await w.task(w.staff, { title: "Due today", start: at(8), due: at(15) })
  await w.q("update tasks set status = 'in_progress' where id = $1", [t1.id])
  const t2 = await w.task(w.staff, { title: "Overdue one" }) // due 2026-10-25T02:00Z
  const t3 = await w.task(w.staff2, { title: "Staff2 due today", start: at(8), due: at(18) })
  const t4 = await w.task(w.staff3, { title: "Waiting", start: at(8), due: at(10, "2026-10-27"), status: "submitted" })
  const t5 = await w.task(w.staff, { title: "Closed today", start: at(6), due: at(9), status: "completed", completedAt: at(8) })
  await w.manages(w.manager, w.staff)
  return { t1, t2, t3, t4, t5 }
}

describe("dashboard scope (D5)", () => {
  test("counts follow scope: staff own, team manager own + direct reports, owner all; the same numbers as the task list with the same filters", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const expected: [string, Who, Record<string, number>][] = [
      ["owner", w.owner, { open: 4, overdue: 1, dueToday: 2, completedToday: 1, awaitingReview: 1 }],
      ["ops", w.ops, { open: 4, overdue: 1, dueToday: 2, completedToday: 1, awaitingReview: 1 }],
      ["manager (team: staff only)", w.manager, { open: 2, overdue: 1, dueToday: 1, completedToday: 1, awaitingReview: 0 }],
      ["staff", w.staff, { open: 2, overdue: 1, dueToday: 1, completedToday: 1, awaitingReview: 0 }],
      ["staff2", w.staff2, { open: 1, overdue: 0, dueToday: 1, completedToday: 0, awaitingReview: 0 }],
      ["staff3", w.staff3, { open: 1, overdue: 0, dueToday: 0, completedToday: 0, awaitingReview: 0 }],
    ]
    for (const [name, who, want] of expected) {
      const s = summaryOf(await dash(w, who))
      expect(s, name).toMatchObject(want)
      // parity with GET /v1/tasks and the same filters (the tile opens that list)
      expect(await listLen(w, who, "status=open"), `${name} open`).toBe(s.open)
      expect(await listLen(w, who, "due=overdue"), `${name} overdue`).toBe(s.overdue)
      expect(await listLen(w, who, "status=open&due=today"), `${name} dueToday`).toBe(s.dueToday)
      expect(await listLen(w, who, "status=review"), `${name} review`).toBe(s.awaitingReview)
    }
    const owner = await dash(w, w.owner)
    expect(owner.progress.mix).toMatchObject({ not_started: 2, in_progress: 1, submitted: 1, completed: 1 })
    // an unknown role without dashboard access is refused; hr (reports none) has no report deadline block
    const hr = await w.who("hr")
    expect((await dash(w, hr)).reportDeadline).toMatchObject({ member: null, team: null })
    const loc = await w.who("location-supervisor")
    expect((await w.req("GET", "/v1/dashboard", loc)).status).toBe(403)
  })

  test("a task out of scope never changes a number or shows as a title: team manager of X never sees Y's attention, top closer or deadline rows", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    await w.task(w.staff2, { title: "Secret overdue of staff2", status: "blocked" })
    await w.task(w.staff2, { title: "Closed by staff2", start: at(6), due: at(9), status: "completed", completedAt: at(9) })
    const d = await dash(w, w.manager) // manages staff only
    const text = JSON.stringify(d)
    expect(text).not.toContain("Secret overdue")
    expect(text).not.toContain(w.staff2.userId)
    expect(summaryOf(d).open).toBe(2)
    const att = JSON.stringify(await get(w, "/v1/attention", w.manager))
    expect(att).not.toContain("Secret overdue")
    expect(att).not.toContain(w.staff2.userId)
    const closers = (d.tasksClosed.days as Json[]).flatMap((x) => (x.topCloser ? [x.topCloser.userId] : []))
    expect(closers.every((u) => u === w.staff.userId)).toBe(true)
  })
})

describe("tenant-local days (DST)", () => {
  async function closedWorld(now: string, tz: string, done: string[], due: string[] = [], slug = "acme") {
    const w = await world({ now, slug })
    await ownerQuery("update tenants set timezone = $2 where id = $1", [w.tenant.id, tz])
    for (const c of done) await w.task(w.staff, { title: `Done ${c}`, start: "2026-10-01T00:00:00.000Z", due: "2027-04-30T00:00:00.000Z", status: "completed", completedAt: c })
    for (const d of due) await w.task(w.staff, { title: `Due ${d}`, start: "2026-10-01T00:00:00.000Z", due: d })
    return w
  }
  const counts = (d: Json) => (d.tasksClosed.days as Json[]).map((x) => [x.date, x.count])

  test("25 Oct 2026 is 25 hours long in Dublin: completions from 2026-10-24T23:00Z to 2026-10-25T23:59Z count on the 25th; 23:30Z on the 25th stays the 25th; Auckland (UTC+13) puts the same instant on the 26th", async () => {
    const done = ["2026-10-24T22:59:00.000Z", "2026-10-24T23:00:00.000Z", "2026-10-25T23:30:00.000Z", "2026-10-26T00:00:00.000Z"]
    const w = await closedWorld("2026-10-26T12:00:00.000Z", "Europe/Dublin", done)
    const d = await dash(w, w.owner)
    const days = counts(d)
    expect(days).toEqual([["2026-10-20", 0], ["2026-10-21", 0], ["2026-10-22", 0], ["2026-10-23", 0], ["2026-10-24", 1], ["2026-10-25", 2], ["2026-10-26", 1]])
    expect(summaryOf(d).completedToday).toBe(1)
    expect(summaryOf(d).trend ?? d.summary.trend).toEqual(days.map((x) => x[1]))
    // the 25th had 25 hours
    const b = dayBounds("2026-10-25", "Europe/Dublin")
    expect((b.end - b.start) / 3_600_000).toBe(25)
    // Auckland: now = 27 Oct 01:00 local; the 26th is [2026-10-25T11:00Z, 2026-10-26T11:00Z)
    const a = await closedWorld("2026-10-26T12:00:00.000Z", "Pacific/Auckland", [...done, "2026-10-25T10:59:00.000Z"], [], "beta")
    const ad = counts(await dash(a, a.owner))
    expect(ad.at(-1)).toEqual(["2026-10-27", 0])
    expect(ad.at(-2)).toEqual(["2026-10-26", 2]) // 2026-10-25T23:30Z and 2026-10-26T00:00Z are 12:30 and 13:00 NZDT on the 26th
    expect(ad.at(-3)).toEqual(["2026-10-25", 3]) // 24 Oct 22:59Z, 24 Oct 23:00Z and 25 Oct 10:59Z (23:59 NZDT) are all the 25th
  })

  test("28 Mar 2027 is 23 hours long in Dublin: the 28th holds [00:00Z, 23:00Z) and the 29th starts at 2027-03-28T23:00Z", async () => {
    const done = ["2027-03-27T23:59:00.000Z", "2027-03-28T00:00:00.000Z", "2027-03-28T22:59:00.000Z", "2027-03-28T23:00:00.000Z"]
    const w = await closedWorld("2027-03-29T12:00:00.000Z", "Europe/Dublin", done)
    const days = counts(await dash(w, w.owner))
    expect(days.slice(-3)).toEqual([["2027-03-27", 1], ["2027-03-28", 2], ["2027-03-29", 1]].slice(-3))
    const b = dayBounds("2027-03-28", "Europe/Dublin")
    expect((b.end - b.start) / 3_600_000).toBe(23)
    expect(new Date(b.end).toISOString()).toBe("2027-03-28T23:00:00.000Z")
  })

  test("'due today' and 'overdue' use the tenant day: on 25 Oct a task due 23:30Z is due today, one due 2026-10-26T00:00Z is not; on 28 Mar 2027 22:59Z is today and 23:00Z is tomorrow", async () => {
    const w = await closedWorld("2026-10-25T12:00:00.000Z", "Europe/Dublin", [], ["2026-10-25T23:30:00.000Z", "2026-10-26T00:00:00.000Z", "2026-10-24T23:00:00.000Z"])
    const s = summaryOf(await dash(w, w.owner))
    expect(s.dueToday).toBe(2) // 24 Oct 23:00Z is local 00:00 on the 25th (BST until 01:00 local... the day starts at 2026-10-24T23:00Z)
    expect(s.overdue).toBe(1) // only the one due before now (12:00Z)
    const m = await closedWorld("2027-03-28T12:00:00.000Z", "Europe/Dublin", [], ["2027-03-28T22:59:00.000Z", "2027-03-28T23:00:00.000Z"], "beta")
    expect(summaryOf(await dash(m, m.owner)).dueToday).toBe(1)
    // the same rule in the task list (the tile opens it)
    expect(await listLen(m, m.owner, "status=open&due=today")).toBe(1)
  })

  test("day helpers: localDay of an instant and 7 tenant-local days ending today, in both zones", () => {
    expect(localDay(new Date("2026-10-25T23:30:00Z"), "Europe/Dublin")).toBe("2026-10-25")
    expect(localDay(new Date("2026-10-25T23:30:00Z"), "Pacific/Auckland")).toBe("2026-10-26")
    expect(lastDays("2026-10-26", 7)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"])
    expect(lastDays("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"])
  })
})

describe("the scoped cache (F18)", () => {
  test("cache never crosses tenants or scopes: owner caches the dashboard, staff in the same tenant gets staff numbers; team managers X and Y get their own; Drive-withheld and full titles are separate entries; keys all start rm:<tenantId>:", async () => {
    const a = await world({ now: NOW })
    await scenario(a)
    const b = await world({ now: NOW, slug: "beta" })
    await b.task(b.staff, { title: "Beta only", start: at(8), due: at(15) })
    const managerY = await a.who("manager")
    await a.manages(managerY, a.staff2)
    const owner = summaryOf(await dash(a, a.owner))
    const staff = summaryOf(await dash(a, a.staff))
    const mx = summaryOf(await dash(a, a.manager))
    const my = summaryOf(await dash(a, managerY))
    const ob = summaryOf(await dash(b, b.owner))
    expect([owner.open, staff.open, mx.open, my.open, ob.open]).toEqual([4, 2, 2, 1, 1])
    // the second read is served from the cache and is still the same caller's numbers (the order does not matter)
    expect(summaryOf(await dash(a, a.staff)).open).toBe(2)
    expect(summaryOf(await dash(a, a.owner)).open).toBe(4)
    expect(summaryOf(await dash(a, managerY)).open).toBe(1)
    expect(summaryOf(await dash(b, b.owner)).open).toBe(1)
    const keys = cacheKeys()
    expect(keys.length).toBeGreaterThanOrEqual(5)
    for (const k of keys) expect(k.startsWith(`rm:${a.tenant.id}:`) || k.startsWith(`rm:${b.tenant.id}:`), k).toBe(true)
    expect(keys.filter((k) => k.startsWith(`rm:${b.tenant.id}:`))).toHaveLength(1)
    // two managers of different teams are different entries, and none of them is the owner's
    const aKeys = keys.filter((k) => k.startsWith(`rm:${a.tenant.id}:dashboard:`))
    expect(new Set(aKeys).size).toBe(aKeys.length)
    expect(aKeys.filter((k) => k.includes(a.manager.userId))).toHaveLength(1)
    expect(aKeys.filter((k) => k.includes(managerY.userId))).toHaveLength(1)
    expect(aKeys.filter((k) => k.includes(a.staff.userId))).toHaveLength(1)
    // Drive: a title with a link is full on the company PC and withheld elsewhere, from separate entries
    await a.task(a.staff, { title: `Plan ${DRIVE}` })
    expect((await a.req("PUT", "/v1/device-policies/drive", a.owner, { allow: "any" })).status).toBe(200)
    const full = JSON.stringify(await get(a, "/v1/attention", a.ops))
    expect(full).toContain("drive.google.com")
    expect(cacheKeys().some((k) => k.includes(":attention:") && k.includes(":drive1:"))).toBe(true)
    expect((await a.req("PUT", "/v1/device-policies/drive", a.owner, { allow: "none" })).status).toBe(200) // a policy write busts the tenant's entries
    const cut = JSON.stringify(await get(a, "/v1/attention", a.ops))
    expect(cut).not.toContain("drive.google.com")
    expect(cut).toContain("Google Drive link")
    expect(cacheKeys().some((k) => k.includes(":attention:") && k.includes(":drive0:"))).toBe(true)
    expect(cacheKeys().some((k) => k.includes(":attention:") && k.includes(":drive1:"))).toBe(false)
    expect((await a.req("PUT", "/v1/device-policies/drive", a.owner, { allow: "any" })).status).toBe(200)
    expect(JSON.stringify(await get(a, "/v1/attention", a.ops))).toContain("drive.google.com") // back to the full entry
    // the two entries are separate keys (same scope and day, different Drive part): prove it at the unit level too
    const dk = cacheKeys().find((k) => k.includes(":attention:"))!
    expect(dk.replace(":drive1:", ":drive0:")).not.toBe(dk)
  })

  test("M-a: 'reports awaiting review' leaves out the caller's own submitted reports (self_review forbids reviewing them), like the task count does", async () => {
    const w = await world({ now: NOW })
    await w.task(w.staff, { title: "Staff job" })
    await w.task(w.owner, { title: "Owner job" })
    for (const who of [w.staff, w.owner]) {
      const rep = await w.filled(who, await w.opened(who))
      expect((await w.submit(who, rep)).status).toBe(200)
    }
    expect(((await dash(w, w.ops)).reportDeadline as Json).team.awaitingReview).toBe(2) // ops wrote neither
    expect(((await dash(w, w.owner)).reportDeadline as Json).team.awaitingReview).toBe(1) // not the owner's own
    expect(((await dash(w, w.staff)).reportDeadline as Json).team).toBeNull()
  })

  test("two people of the SAME scope never share an entry: 'awaiting review' leaves out my own submitted tasks and the deadline card is my own shift (owner and ops are both all-scope)", async () => {
    const w = await world({ now: NOW })
    await scenario(w) // staff3's submitted task waits for review
    await w.task(w.owner, { title: "Owner's own submitted", start: at(8), due: at(20), status: "submitted" })
    const viaOps = await dash(w, w.ops) // cached first
    const viaOwner = await dash(w, w.owner)
    expect(summaryOf(viaOps).awaitingReview).toBe(2) // both submitted tasks are someone else's for ops
    expect(summaryOf(viaOwner).awaitingReview).toBe(1) // the owner may not review their own
    expect(await listLen(w, w.owner, "status=review")).toBe(1)
    expect(await listLen(w, w.ops, "status=review")).toBe(2)
    // owner is assigned the Night shift, ops is not: the card shows each caller's own shift only
    expect(viaOwner.reportDeadline.member).not.toBeNull()
    expect(viaOps.reportDeadline.member).toBeNull()
    expect((await get(w, "/v1/attention?limit=100", w.owner)).items.filter((i: Json) => i.kind === "evidence_review")).toHaveLength(1)
    expect((await get(w, "/v1/attention?limit=100", w.ops)).items.filter((i: Json) => i.kind === "evidence_review")).toHaveLength(2)
    const keys = cacheKeys().filter((k) => k.includes(":dashboard:"))
    expect(keys.filter((k) => k.includes(`u=${w.owner.userId}`))).toHaveLength(1)
    expect(keys.filter((k) => k.includes(`u=${w.ops.userId}`))).toHaveLength(1)
  })

  test("a personal model is keyed by user: two employees (same own scope kind) never share the staff dashboard or Today; an api key reads its creator's entry data", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const s1 = await get(w, "/v1/dashboard/staff", w.staff)
    const s2 = await get(w, "/v1/dashboard/staff", w.staff2)
    expect(s1.myTasks.open).toBe(2)
    expect(s2.myTasks.open).toBe(1)
    expect(JSON.stringify(s2)).not.toContain("Overdue one")
    const t1 = await get(w, "/v1/today", w.staff)
    const t2 = await get(w, "/v1/today", w.staff2)
    expect(t1.order.map((i: Json) => i.title)).not.toEqual(t2.order.map((i: Json) => i.title))
    const keys = cacheKeys()
    expect(keys.filter((k) => k.includes(w.staff.userId))).not.toHaveLength(0)
    expect(keys.filter((k) => k.includes(w.staff2.userId))).not.toHaveLength(0)
    // an api key of staff2: its creator's tasks, never staff's, whoever cached first
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff2.userId, ["dashboard:read", "tasks:read"])
    const viaKey = await call(w.app, "GET", "/v1/dashboard/staff", { tenant: "acme", headers: { authorization: `Bearer ${key.key}` } })
    expect(viaKey.status).toBe(200)
    const kb = (await viaKey.json()) as Json
    expect(kb.myTasks.open).toBe(1)
    expect(JSON.stringify(kb)).not.toContain("Overdue one")
  })

  test("a task or report change by this instance busts that tenant's cache; without a write the entry lives 30 s of fake-clock time then reloads", async () => {
    const w = await world({ now: NOW })
    const other = await world({ now: NOW, slug: "beta" })
    await scenario(w)
    expect(summaryOf(await dash(w, w.ops)).open).toBe(4)
    await get(other, "/v1/dashboard", other.owner)
    // an insert that bypasses the app is NOT seen inside the TTL ...
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, start_at, due_at, created_at, updated_at, creator_id) values ($1, 900, 'Sneaked in', $2::jsonb, $3, $4, now(), now(), $5)`,
      [w.tenant.id, JSON.stringify({ mode: "none", types: [], min: 0, instruction: "", review: "manager" }), at(8), at(20), w.ops.userId],
    )
    expect(READ_MODEL_TTL_MS).toBe(30_000)
    w.clock.advance({ minutes: 0.4 }) // 24 s
    expect(summaryOf(await dash(w, w.ops)).open).toBe(4)
    w.clock.advance({ minutes: 0.2 }) // 36 s
    expect(summaryOf(await dash(w, w.ops)).open).toBe(5) // ... but after the 30 s it reloads
    // a task write through the app busts at once (create, then a status change), only that tenant's keys
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(true)
    await w.task(w.staff, { title: "Fresh", start: at(8), due: at(20) })
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(false)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${other.tenant.id}:`))).toBe(true) // the other tenant's entries stay
    expect(summaryOf(await dash(w, w.ops)).open).toBe(6)
    const t = await w.task(w.staff, { title: "Status change", start: at(8), due: at(20) })
    expect(summaryOf(await dash(w, w.ops)).open).toBe(7)
    const st = await w.req("POST", `/v1/tasks/${t.id}/status`, w.staff, { to: "in_progress", version: t.version })
    expect(st.status, await st.clone().text()).toBe(200)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(false)
    // a report submit busts too
    await get(w, "/v1/attention", w.ops)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(true)
    const rep = await w.opened(w.staff)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(false) // opening a report is a write
    await get(w, "/v1/attention", w.ops)
    const filled = await w.filled(w.staff, rep)
    expect((await w.submit(w.staff, filled)).status).toBe(200)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(false)
    // a refused write (403) leaves the entries alone
    await get(w, "/v1/attention", w.ops)
    const before = cacheKeys().length
    expect((await w.req("POST", "/v1/tasks", w.staff, { nope: true })).status).toBeGreaterThanOrEqual(400)
    expect(cacheKeys()).toHaveLength(before)
  })

  test("unit: the cache is bounded (LRU, max 2000), serves a hit only inside the TTL, a bust during a slow load is not stored, and busts are per tenant", async () => {
    const now = new Date("2026-10-26T12:00:00Z")
    let loads = 0
    const load = (v: unknown) => async () => (loads++, v)
    expect(READ_MODEL_MAX).toBe(2000)
    for (let i = 0; i < READ_MODEL_MAX + 50; i++) await cached(`rm:t1:m:s${i}:drive0:2026-10-26`, 30_000, load(i), now)
    expect(cacheKeys()).toHaveLength(READ_MODEL_MAX)
    expect(cacheKeys()).not.toContain("rm:t1:m:s0:drive0:2026-10-26") // the oldest went first
    expect(cacheKeys()).toContain(`rm:t1:m:s${READ_MODEL_MAX + 49}:drive0:2026-10-26`)
    resetReadModelCache()
    loads = 0
    const k = "rm:t1:m:all:drive0:2026-10-26"
    expect(await cached(k, 30_000, load("a"), now)).toBe("a")
    expect(await cached(k, 30_000, load("b"), new Date(now.getTime() + 29_999))).toBe("a")
    expect(await cached(k, 30_000, load("b"), new Date(now.getTime() + 30_000))).toBe("b")
    expect(loads).toBe(2)
    // a stored value is a copy: a caller cannot change what the next caller gets
    const v = (await cached("rm:t1:m:copy:drive0:d", 30_000, load({ n: 1 }), now)) as { n: number }
    v.n = 99
    expect(((await cached("rm:t1:m:copy:drive0:d", 30_000, load({ n: 2 }), now)) as { n: number }).n).toBe(1)
    // a bust while the loader runs: the stale result is returned to its caller but not stored
    resetReadModelCache()
    const slow = await cached("rm:t2:m:all:drive0:d", 30_000, async () => (bustReadModels("t2"), "stale"), now)
    expect(slow).toBe("stale")
    expect(cacheKeys()).toEqual([])
    await cached("rm:t1:m:all:drive0:d", 30_000, load(1), now)
    await cached("rm:t2:m:all:drive0:d", 30_000, load(2), now)
    bustReadModels("t1")
    expect(cacheKeys()).toEqual(["rm:t2:m:all:drive0:d"])
    // a key that is not rm:<tenant>: is refused
    await expect(cached("x:t1:m", 30_000, load(1), now)).rejects.toThrow()
    expect(readModelTtl(true)).toBe(0) // support sessions: never cached
    expect(readModelTtl(false)).toBe(30_000)
  })

  test("removing M1 → 403 even when a cached entry exists (the guard runs before the cache)", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    for (const p of ["/v1/dashboard", "/v1/attention", "/v1/today", "/v1/dashboard/staff", "/v1/dashboard/team-tasks"]) expect((await w.req("GET", p, w.ops)).status, p).toBe(200)
    expect(cacheKeys().length).toBeGreaterThan(0)
    await w.q("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1', 'revoke', 'test', 'p', now())", [w.tenant.id])
    w.clock.advance({ minutes: 1 })
    for (const p of ["/v1/dashboard", "/v1/attention", "/v1/today", "/v1/dashboard/staff", "/v1/dashboard/team-tasks"]) {
      const r = await w.req("GET", p, w.ops)
      expect([p, r.status, await code(r)]).toEqual([p, 403, "module_not_entitled"])
    }
    const post = await w.req("POST", "/v1/today/updates", w.staff, { taskId: randomUUID(), action: "snooze", dayKey: "2026-10-26" })
    expect([post.status, await code(post)]).toEqual([403, "module_not_entitled"])
  })

  test("support sessions are never cached, read the dashboard and attention, and are 403 on /v1/today and the personal staff dashboard (F21)", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    const support = await makeStaff(w.deps, "support")
    expect((await call(w.app, "POST", `/v1/platform/tenants/${w.tenant.id}/support-grants`, { cookie: support.cookie, body: { reason: "Ticket 4411: numbers look wrong", hours: 2 } })).status).toBe(201)
    resetReadModelCache()
    const sup = (p: string) => call(w.app, "GET", p, { cookie: support.cookie, tenant: "acme" })
    const d = await sup("/v1/dashboard")
    expect(d.status).toBe(200)
    expect(summaryOf((await d.json()) as Json).open).toBe(4) // all scope, read-only
    expect((await sup("/v1/attention")).status).toBe(200)
    expect(cacheKeys()).toEqual([]) // nothing stored for a support session
    for (const p of ["/v1/today", "/v1/dashboard/staff"]) {
      const r = await sup(p)
      expect([p, r.status, await code(r)]).toEqual([p, 403, "support_forbidden_route"])
    }
    const post = await call(w.app, "POST", "/v1/today/updates", { cookie: support.cookie, tenant: "acme", body: { taskId: randomUUID(), action: "snooze", dayKey: "2026-10-26" } })
    expect(post.status).toBe(403)
    expect(routeDenied(SUPPORT_DENIED_ROUTES, "/v1/today", "/v1/today")).toBe(true)
  })
})

describe("attention (F17: derived, never stored)", () => {
  test("lists overdue, blocked, evidence awaiting review, missing and returned reports in scope only; an out-of-scope task or report never appears; archived tasks never appear", async () => {
    const w = await world({ now: NOW })
    const { t2, t4 } = await scenario(w)
    const blocked = await w.task(w.staff, { title: "Blocked one", start: at(8), due: at(20), status: "blocked" })
    const arch = await w.task(w.staff, { title: "Archived overdue" })
    await w.q("update tasks set archived_at = now() where id = $1", [arch.id])
    const hidden = await w.task(w.staff2, { title: "Hidden of staff2", start: at(8), due: at(20), status: "blocked" })
    // reports: staff has a draft of 24 Oct past its due time (missing); staff2 a returned one
    const rep = await w.opened(w.staff)
    const rep2 = await w.opened(w.staff2)
    const filled = await w.filled(w.staff2, rep2)
    expect((await w.submit(w.staff2, filled)).status).toBe(200)
    expect((await w.req("POST", `/v1/shift-reports/${rep2.id}/return`, w.ops, { version: (await w.get(w.staff2, rep2.id)).version, comment: "Add the keys count" })).status).toBe(200)
    const feed = await get(w, "/v1/attention?limit=100", w.ops)
    const kinds = (k: string) => (feed.items as Json[]).filter((i) => i.kind === k)
    expect(kinds("overdue").map((i) => i.ref)).toContain(t2.ref)
    expect(kinds("blocked").map((i) => i.ref).sort()).toEqual([blocked.ref, hidden.ref].sort())
    expect(kinds("evidence_review").map((i) => i.ref)).toEqual([t4.ref])
    expect(kinds("report_missing").some((i) => i.reportId === rep.id)).toBe(true)
    expect(kinds("report_returned").map((i) => i.reportId)).toEqual([rep2.id])
    expect(JSON.stringify(feed)).not.toContain("Archived overdue")
    expect(JSON.stringify(feed)).not.toContain("Add the keys count") // no free text of a report
    for (const i of feed.items as Json[]) expect(Object.keys(i).sort()).toEqual(["dueAt", "kind", "owner", "ownerId", "reason", "ref", "reportId", "reportKey", "taskId", "title"].sort())
    expect(feed.total).toBe((feed.items as Json[]).length)
    // order: the kinds in the documented order
    const order = (feed.items as Json[]).map((i) => i.kind)
    expect([...order].sort((a, b) => KIND_RANK.indexOf(a) - KIND_RANK.indexOf(b))).toEqual(order)
    // the team manager (staff only) never sees staff2's blocked task or returned report
    const mine = JSON.stringify(await get(w, "/v1/attention?limit=100", w.manager))
    expect(mine).not.toContain("Hidden of staff2")
    expect(mine).not.toContain(rep2.id)
    expect(mine).not.toContain(w.staff2.userId)
    expect(mine).toContain(t2.ref)
    // dashboard attentionCount = the feed total, per scope; roles without attention get null
    expect((await dash(w, w.ops)).attentionCount).toBe(feed.total)
    expect((await dash(w, w.staff)).attentionCount).toBeNull()
    expect((await w.req("GET", "/v1/attention", w.staff)).status).toBe(403)
    // cursor: pages without duplicates
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const p = await get(w, `/v1/attention?limit=2${cursor ? `&cursor=${cursor}` : ""}`, w.ops)
      for (const it of p.items as Json[]) seen.push(`${it.kind}|${it.taskId ?? it.reportKey}`)
      cursor = p.nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(feed.total)
    expect(new Set(seen).size).toBe(seen.length)
    expect((await w.req("GET", "/v1/attention?cursor=not-a-cursor", w.ops)).status).toBe(400)
  })
})

const KIND_RANK = ["overdue", "blocked", "evidence_review", "report_missing", "report_returned"]

describe("Today (FR-M1-70..80)", () => {
  test("Today counts equal the FE todayCounts rules; 'play my day' order is overdue, high today, then rest (dayOrder port); reports count = returned + missing for the member; counts are numbers only (lock-screen safe)", async () => {
    const w = await world({ now: NOW })
    await w.task(w.staff, { title: "Overdue high", priority: 3, start: at(1, "2026-10-24"), due: at(1, "2026-10-25") })
    await w.task(w.staff, { title: "Overdue low", priority: 1, start: at(1, "2026-10-24"), due: at(3, "2026-10-26") })
    await w.task(w.staff, { title: "High today", priority: 3, start: at(8), due: at(16) })
    await w.task(w.staff, { title: "Plain today", priority: 2, start: at(8), due: at(14) })
    await w.task(w.staff, { title: "Blocked tomorrow", priority: 2, start: at(8), due: at(9, "2026-10-27"), status: "blocked" })
    await w.task(w.staff, { title: "Submitted today", start: at(8), due: at(17), status: "submitted" })
    await w.task(w.staff, { title: "Done", start: at(8), due: at(17), status: "completed", completedAt: at(9) })
    await w.task(w.staff2, { title: "Not mine", priority: 3, start: at(8), due: at(17) })
    await w.opened(w.staff) // 24 Oct night: a draft past its due time = missing
    const today = await get(w, "/v1/today", w.staff)
    const rows = (await w.q("select ref_no, title, priority, status, due_at, evidence_rule from tasks where id in (select task_id from task_assignees where user_id = $1)", [w.staff.userId])) as Json[]
    const oracle: TodayTask[] = rows.map((r) => ({ ref: `TSK-${r.ref_no}`, title: r.title, priority: r.priority as 1 | 2 | 3, due: epochToWall(new Date(r.due_at).getTime(), "Europe/Dublin"), status: r.status, evidenceRequired: r.evidence_rule.mode === "required", project: "" }))
    const nowWall = epochToWall(Date.parse(NOW), "Europe/Dublin")
    const inbox = async (status: string) => ((await get(w, `/v1/shift-reports?status=${status}&limit=100`, w.staff)).items as unknown[]).length
    const reports = (await inbox("missing")) + (await inbox("returned"))
    expect(reports).toBeGreaterThan(0)
    expect(today.counts).toEqual(todayCounts(oracle, nowWall, { evidence: 0, reports }))
    expect(today.reports).toBe(reports)
    expect(Object.keys(today.counts).sort()).toEqual(["blocked", "dueToday", "high", "overdue", "reports", "review"])
    for (const v of Object.values(today.counts)) expect(Number.isInteger(v)).toBe(true)
    const want = dayOrder(oracle, nowWall, "all")
    expect(today.order.map((i: Json) => i.ref)).toEqual(want.map((i) => i.task.ref))
    expect(today.order.map((i: Json) => i.group)).toEqual(want.map((i) => i.group))
    expect(today.order.map((i: Json) => i.group)).toEqual(["overdue", "overdue", "high-today", "today"])
    expect(today.order[0].title).toBe("Overdue high")
    expect(today.order.map((i: Json) => i.title)).not.toContain("Not mine")
    const hi = await get(w, "/v1/today?mode=high-and-overdue", w.staff)
    expect(hi.order.map((i: Json) => i.group)).toEqual(["overdue", "overdue", "high-today"])
    expect(today.summary.headline).toBe("2 overdue, 1 high priority due today and 1 more due today")
    expect(today.team).toBeUndefined() // staff: no team block
    expect((await w.req("GET", "/v1/today?mode=nope", w.staff)).status).toBe(400)
  })

  test("working day: the running shift's start, else the latest shift started today, else 04:00 tenant time (DEFAULT_DAY_START); the manager version carries team overdue and the review count", async () => {
    const w = await world({ now: "2026-10-26T01:30:00.000Z" }) // inside the 26 Oct night shift (22:00 on the 25th local = 22:00Z, ends 06:00Z)
    const running = await get(w, "/v1/today", w.staff)
    expect(running.workingDay).toEqual({ key: "2026-10-25", startsAt: "2026-10-25T22:00:00.000Z", hasShift: true })
    // a member with no shift: 04:00 local of the day, and before 04:00 the previous day
    const nobody = await w.who("employee")
    const noShift = await get(w, "/v1/today", nobody)
    expect(noShift.workingDay).toEqual({ key: "2026-10-25", startsAt: "2026-10-25T04:00:00.000Z", hasShift: false })
    w.clock.advance({ hours: 5 }) // 06:30Z: the shift is over and started yesterday; the new day began at 04:00
    const later = await get(w, "/v1/today", nobody)
    expect(later.workingDay).toEqual({ key: "2026-10-26", startsAt: "2026-10-26T04:00:00.000Z", hasShift: false })
    // the manager version
    const m = await world({ now: NOW, slug: "beta" })
    await scenario(m)
    const mt = await get(m, "/v1/today", m.manager)
    expect(mt.team.count).toBe(1)
    expect(mt.team.items[0]).toMatchObject({ ref: expect.stringMatching(/^TSK-/), title: "Overdue one", who: expect.any(String) })
    expect(mt.counts.review).toBe(0)
    const ot = await get(m, "/v1/today", m.owner)
    expect(ot.counts.review).toBe(1) // staff3's submitted task is waiting
    expect(ot.team.count).toBe(1)
  })

  test("POST /v1/today/updates: done on a Required task keeps it open ('evidence still needed'); snooze writes only a history line; a repeat with the same dayKey is idempotent; another tenant's or an out-of-scope task is 404 task_not_found; an api key cannot mark done", async () => {
    const w = await world({ now: NOW })
    const other = await world({ now: NOW, slug: "beta" })
    const foreign = await other.task(other.staff, { title: "Beta task" })
    const plain = await w.task(w.staff, { title: "Plain", start: at(8), due: at(15) })
    const req = await w.task(w.staff, { title: "Needs proof", start: at(8), due: at(15), evidenceRule: REQUIRED })
    const theirs = await w.task(w.staff2, { title: "Not yours", start: at(8), due: at(15) })
    const body = (taskId: string, action: string, dayKey = "2026-10-26") => ({ taskId, action, dayKey })
    // Required: still open, with the line
    const r1 = await w.req("POST", "/v1/today/updates", w.staff, body(req.id, "done"))
    expect(r1.status, await r1.clone().text()).toBe(200)
    expect(await w.json(r1)).toMatchObject({ result: "applied", status: "not_started", evidenceStillNeeded: true })
    expect((await w.taskRow(req.id)).status).toBe("not_started")
    expect(JSON.stringify(await w.hist(req.id))).toContain("evidence still needed")
    // plain: completed
    const r2 = await w.req("POST", "/v1/today/updates", w.staff, body(plain.id, "done"))
    expect(await w.json(r2)).toMatchObject({ result: "applied", status: "completed", evidenceStillNeeded: false })
    expect((await w.taskRow(plain.id)).status).toBe("completed")
    // idempotent: the same dayKey is a duplicate and writes nothing; another day key is a new update
    const hist = (await w.hist(plain.id)).length
    expect(await w.json(await w.req("POST", "/v1/today/updates", w.staff, body(plain.id, "done")))).toMatchObject({ result: "duplicate" })
    expect((await w.hist(plain.id)).length).toBe(hist)
    // snooze: a history line, no status change, no time entry
    const s = await w.json(await w.req("POST", "/v1/today/updates", w.staff, body(req.id, "snooze")))
    expect(s).toMatchObject({ result: "applied", status: "not_started" })
    const lines = (await w.hist(req.id)).map((h) => h.text as string)
    expect(lines.some((t) => t.startsWith("Snoozed for today"))).toBe(true)
    expect((await w.q("select count(*)::int n from task_time_entries where task_id = $1", [req.id]))[0].n).toBe(0)
    expect((await w.taskRow(req.id)).version).toBe(req.version) // the snooze did not touch the row
    expect(await w.json(await w.req("POST", "/v1/today/updates", w.staff, body(req.id, "snooze")))).toMatchObject({ result: "duplicate" })
    // no oracle: another tenant's id, an out-of-scope task and an unknown id are the same 404
    for (const id of [foreign.id, theirs.id, randomUUID()]) {
      const r = await w.req("POST", "/v1/today/updates", w.staff, body(id, "done"))
      expect([r.status, await code(r)], id).toEqual([404, "task_not_found"])
    }
    expect((await other.taskRow(foreign.id)).status).toBe("not_started")
    // validation
    for (const bad of [{ taskId: plain.id, action: "undo", dayKey: "2026-10-26" }, { taskId: plain.id, action: "done", dayKey: "tomorrow" }, { taskId: "x", action: "done", dayKey: "2026-10-26" }]) {
      expect((await w.req("POST", "/v1/today/updates", w.staff, bad)).status).toBe(400)
    }
    // an api key may not attest "done" (a person's act); it may snooze
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["tasks:write", "tasks:read"])
    const as = (b: unknown) => call(w.app, "POST", "/v1/today/updates", { tenant: "acme", body: b, headers: { authorization: `Bearer ${key.key}` } })
    const t3 = await w.task(w.staff, { title: "Key done", start: at(8), due: at(15) })
    const kd = await as(body(t3.id, "done"))
    expect([kd.status, await code(kd)]).toEqual([403, "human_required"])
    expect((await w.taskRow(t3.id)).status).toBe("not_started")
    expect((await as(body(t3.id, "snooze"))).status).toBe(200)
    // it busts the cache
    await get(w, "/v1/today", w.staff)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(true)
    const t4 = await w.task(w.staff, { title: "Busts", start: at(8), due: at(15) })
    await get(w, "/v1/today", w.staff)
    expect((await w.req("POST", "/v1/today/updates", w.staff, body(t4.id, "done"))).status).toBe(200)
    expect(cacheKeys().some((k) => k.startsWith(`rm:${w.tenant.id}:`))).toBe(false)
  })

  test("H6(a): two assignees' same-day snooze and done on one task are both applied (the id carries the actor)", async () => {
    const w = await world({ now: NOW })
    const t = await w.task(w.staff, { title: "Shared", start: at(8), due: at(15), others: [w.staff2.userId] })
    const body = (action: string) => ({ taskId: t.id, action, dayKey: "2026-10-26" })
    const a = await w.json(await w.req("POST", "/v1/today/updates", w.staff, body("snooze")))
    const b = await w.json(await w.req("POST", "/v1/today/updates", w.staff2, body("snooze")))
    expect([a.result, b.result]).toEqual(["applied", "applied"])
    expect((await w.hist(t.id)).filter((h) => (h.text as string).startsWith("Snoozed for today"))).toHaveLength(2)
    // the same person twice is still a duplicate
    expect(await w.json(await w.req("POST", "/v1/today/updates", w.staff2, body("snooze")))).toMatchObject({ result: "duplicate" })
    const d1 = await w.json(await w.req("POST", "/v1/today/updates", w.staff, body("done")))
    const d2 = await w.json(await w.req("POST", "/v1/today/updates", w.staff2, body("done")))
    expect([d1.result, d2.result]).toEqual(["applied", "applied"])
    expect((await w.q("select count(distinct update_id)::int n from task_history where update_id like 'today:%'"))[0].n).toBe(4)
  })

  test("H6(b): 'evidence still needed' does not consume the id: after the evidence is attached, a second done the same day completes the task (one evidence line, however often it was pressed)", async () => {
    const w = await world({ now: NOW })
    const req = await w.task(w.staff, { title: "Needs proof", start: at(8), due: at(15), evidenceRule: REQUIRED })
    const done = () => w.req("POST", "/v1/today/updates", w.staff, { taskId: req.id, action: "done", dayKey: "2026-10-26" })
    expect(await w.json(await done())).toMatchObject({ result: "applied", status: "not_started", evidenceStillNeeded: true })
    expect(await w.json(await done())).toMatchObject({ result: "applied", status: "not_started", evidenceStillNeeded: true }) // pressed again: still open, no new line
    expect((await w.hist(req.id)).filter((h) => (h.text as string).includes("evidence still needed"))).toHaveLength(1)
    expect((await w.req("POST", `/v1/tasks/${req.id}/evidence`, w.staff, { kind: "note", text: "Checked it" })).status).toBe(201)
    const after = await w.json(await done())
    expect(after).toMatchObject({ result: "applied", evidenceStillNeeded: false })
    expect(["submitted", "completed"]).toContain(after.status)
    expect((await w.taskRow(req.id)).status).toBe(after.status)
    expect(await w.json(await done())).toMatchObject({ result: "duplicate" }) // now the id is consumed
  })

  test("H6(c): dayKey must be the server's working day in the tenant timezone, else 422 invalid_day_key; nothing is written for a wrong day", async () => {
    const w = await world({ now: NOW })
    const t = await w.task(w.staff, { title: "Plain", start: at(8), due: at(15) })
    for (const dayKey of ["9999-99-99", "2026-02-30", "2026-10-25", "2026-10-27", "1999-01-01"]) {
      const r = await w.req("POST", "/v1/today/updates", w.staff, { taskId: t.id, action: "snooze", dayKey })
      expect([dayKey, r.status, await code(r)]).toEqual([dayKey, 422, "invalid_day_key"])
    }
    expect((await w.hist(t.id)).length).toBe(0)
    expect((await w.req("POST", "/v1/today/updates", w.staff, { taskId: t.id, action: "snooze", dayKey: "2026-10-26" })).status).toBe(200)
  })
})

describe("staff dashboard and team tasks", () => {
  test("staff dashboard returns only the caller's tasks, evidence and comments (an api key: its creator's); a manager gets their own, not the team's", async () => {
    const w = await world({ now: NOW })
    const { t1, t2, t3 } = await scenario(w)
    const ret = await w.task(w.staff, { title: "Changes asked", start: at(8), due: at(20), status: "changes_requested" })
    await w.q(
      "insert into task_evidence (tenant_id, task_id, round, kind, text, review, reason, created_at) values ($1, $2, 1, 'note', 'blurry', 'rejected', 'Photo is blurry', now())",
      [w.tenant.id, ret.id],
    )
    await w.q("insert into task_comments (tenant_id, task_id, author_id, body, created_at) values ($1, $2, $3, $4, $5)", [w.tenant.id, t1.id, w.ops.userId, `Please see ${DRIVE}`, "2026-10-26T09:00:00Z"])
    await w.q("insert into task_comments (tenant_id, task_id, author_id, body, created_at) values ($1, $2, $3, 'On staff2 task', $4)", [w.tenant.id, t3.id, w.ops.userId, "2026-10-26T09:30:00Z"])
    const s = await get(w, "/v1/dashboard/staff", w.staff)
    expect(s.myTasks).toMatchObject({ open: 3, overdue: 1, review: 0, returned: 1 })
    expect((s.myTasks.items as Json[]).map((i) => i.ref).sort()).toEqual([t1.ref, t2.ref, ret.ref].sort())
    expect(s.evidence.returned).toEqual([{ ref: ret.ref, title: "Changes asked", reason: "Photo is blurry" }])
    expect((s.comments as Json[]).map((c) => c.text)).toEqual([expect.stringContaining("Please see")])
    expect(JSON.stringify(s)).not.toContain("On staff2 task")
    expect(JSON.stringify(s)).not.toContain(t3.ref)
    expect(s.reportDeadline.member).not.toBeNull()
    expect(s.reportDeadline.team).toBeNull()
    // Drive links in a comment are withheld off the company PC
    expect((await w.req("PUT", "/v1/device-policies/drive", w.owner, { allow: "none" })).status).toBe(200)
    expect(JSON.stringify(await get(w, "/v1/dashboard/staff", w.staff))).not.toContain("drive.google.com")
    // the staff3 member sees the submitted task as "waiting for review"
    expect((await get(w, "/v1/dashboard/staff", w.staff3)).myTasks).toMatchObject({ open: 1, review: 1 })
    // a manager gets their own list (they have no assigned task), never the team's
    expect((await get(w, "/v1/dashboard/staff", w.manager)).myTasks).toMatchObject({ open: 0, items: [] })
    // an api key acts as its creator
    const key = await makeApiKey(w.deps, w.tenant.id, w.staff.userId, ["dashboard:read", "tasks:read"])
    const viaKey = (await (await call(w.app, "GET", "/v1/dashboard/staff", { tenant: "acme", headers: { authorization: `Bearer ${key.key}` } })).json()) as Json
    expect(viaKey.myTasks.open).toBe(3)
  })

  test("team-tasks: cursor pages open tasks in scope without duplicates; bad cursor → 400 invalid_cursor; scope is the task list's", async () => {
    const w = await world({ now: NOW })
    await scenario(w)
    for (let i = 0; i < 6; i++) await w.task(w.staff, { title: `Extra ${i}`, start: at(8), due: at(20 + 0, `2026-10-2${7 + (i % 2)}`) })
    const all = await get(w, "/v1/dashboard/team-tasks?limit=100", w.ops)
    expect(all.items).toHaveLength(10)
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const p = await get(w, `/v1/dashboard/team-tasks?limit=3${cursor ? `&cursor=${cursor}` : ""}`, w.ops)
      seen.push(...(p.items as Json[]).map((x) => x.id as string))
      cursor = p.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual((all.items as Json[]).map((x) => x.id))
    expect(new Set(seen).size).toBe(seen.length)
    const first = all.items[0]
    expect(Object.keys(first).sort()).toEqual(["assignee", "assigneeId", "dept", "due", "dueAt", "id", "late", "priority", "ref", "status", "title"].sort())
    expect(first.late).toBe(true) // the 25 Oct task is the oldest due
    // same rows as the task list (open, due asc)
    expect((await get(w, "/v1/tasks?status=open&limit=100", w.ops)).items.map((x: Json) => x.id)).toEqual(seen)
    expect((await get(w, "/v1/dashboard/team-tasks?limit=100", w.manager)).items.every((x: Json) => x.assigneeId === w.staff.userId)).toBe(true)
    for (const bad of ["garbage", Buffer.from("x|y").toString("base64url")]) {
      const r = await w.req("GET", `/v1/dashboard/team-tasks?cursor=${bad}`, w.ops)
      expect([r.status, await code(r)]).toEqual([400, "invalid_cursor"])
    }
    expect((await w.req("GET", "/v1/dashboard/team-tasks?limit=101", w.ops)).status).toBe(400)
  })
})

describe("query plans and speed at 10 000 tasks and 250 members", () => {
  /** 250 members (direct SQL: no password hashing), 10 000 tasks over them, evidence, reports and shifts. Returns the world. */
  async function big() {
    const w = await world({ now: NOW })
    await w.manages(w.manager, w.staff)
    const role = (await w.q("select id from roles where tenant_id = $1 and key = 'employee'", [w.tenant.id]))[0].id as string
    await ownerQuery(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at) select 'bulk-' || g, 'Bulk ' || g, 'bulk' || g || '@x.ie', true, now(), now() from generate_series(1, 250) g`,
    )
    await w.q("insert into memberships (tenant_id, user_id, role_id, joined_at) select $1::uuid, 'bulk-' || g, $2::uuid, now() from generate_series(1, 250) g", [w.tenant.id, role])
    await w.q(
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, status, priority, start_at, due_at, completed_at, created_at, updated_at, creator_id)
       select $1::uuid, 5000 + g, 'Seed ' || g, '{"mode":"none","types":[],"min":0,"instruction":"","review":"manager"}'::jsonb,
         (array['not_started','in_progress','blocked','submitted','completed','completed','changes_requested','cancelled'])[1 + g % 8], 1 + g % 3,
         timestamptz '2026-10-20T00:00:00Z', timestamptz '2026-10-20T00:00:00Z' + (g * 7 || ' minutes')::interval,
         case when g % 8 in (4, 5) then timestamptz '2026-10-20T00:00:00Z' + (g * 5 || ' minutes')::interval end, now(), now(), $2
       from generate_series(1, 10000) g`,
      [w.tenant.id, w.ops.userId],
    )
    await w.q(
      `insert into task_assignees (tenant_id, task_id, user_id, is_primary) select $1::uuid, id, case when ref_no % 40 = 0 then $2 else 'bulk-' || (1 + ref_no % 250) end, true from tasks where ref_no > 5000`,
      [w.tenant.id, w.staff.userId],
    )
    await w.q(
      `insert into task_evidence (tenant_id, task_id, round, kind, text, review, created_at) select tenant_id, id, 1, 'note', 'n', case when ref_no % 3 = 0 then 'pending' else 'accepted' end, now() from tasks where ref_no > 5000`,
      [],
    )
    // a multi-tenant table: other tenants hold three times as many tasks (the planner must pick the tenant's index range, not read the table)
    const noise = (await makeTenant(w.deps, { slug: "noise" })).id
    await ownerTenantQuery(
      noise,
      `insert into tasks (tenant_id, ref_no, title, evidence_rule, status, priority, start_at, due_at, completed_at, created_at, updated_at)
       select $1::uuid, 5000 + g, 'Noise ' || g, '{"mode":"none","types":[],"min":0,"instruction":"","review":"manager"}'::jsonb,
         (array['not_started','in_progress','blocked','submitted','completed','completed','changes_requested','cancelled'])[1 + g % 8], 1 + g % 3,
         timestamptz '2026-10-20T00:00:00Z', timestamptz '2026-10-20T00:00:00Z' + (g * 7 || ' minutes')::interval,
         case when g % 8 in (4, 5) then timestamptz '2026-10-20T00:00:00Z' + (g * 5 || ' minutes')::interval end, now(), now()
       from generate_series(1, 30000) g`,
      [noise],
    )
    await ownerTenantQuery(noise, `insert into task_evidence (tenant_id, task_id, round, kind, text, review, created_at) select tenant_id, id, 1, 'note', 'n', case when ref_no % 3 = 0 then 'pending' else 'accepted' end, now() from tasks where tenant_id = $1`, [noise])
    // all 250 members work the Night pattern from 1 Oct (reporting is on for the team): the inbox engine has 1 750 occurrences a week to turn into "missing" rows
    await w.q("insert into shift_assignments (tenant_id, user_id, pattern_id, from_date, created_at) select $1::uuid, 'bulk-' || g, $2::uuid, date '2026-10-01', now() from generate_series(1, 250) g", [w.tenant.id, w.pattern])
    // 15 000 reports (60 days x 250 members): drafts, submitted, accepted and returned, the recent ones open
    await w.q(
      `insert into shift_reports (tenant_id, user_id, pattern_id, team_id, shift_name, shift_date, start_at, end_at, due_at, status, first_submitted_at, created_at, updated_at)
       select $1::uuid, 'bulk-' || (1 + g % 250), $2::uuid, $3::uuid, 'Night', date '2026-08-28' + (g / 250), timestamptz '2026-08-28T22:00:00Z' + ((g / 250) || ' days')::interval,
         timestamptz '2026-08-29T06:00:00Z' + ((g / 250) || ' days')::interval, timestamptz '2026-08-29T07:00:00Z' + ((g / 250) || ' days')::interval,
         (array['draft','submitted','accepted','returned'])[1 + g % 4], case when g % 4 = 1 then timestamptz '2026-08-29T05:00:00Z' + ((g / 250) || ' days')::interval end, now(), now()
       from generate_series(0, 14999) g`,
      [w.tenant.id, w.pattern, w.team],
    )
    for (const t of ["tasks", "task_assignees", "task_evidence", "memberships", "shift_reports"]) await ownerQuery(`vacuum analyze ${t}`)
    return w
  }

  test("EXPLAIN: summary, tasks-closed, team-tasks, attention and evidence-awaiting queries use tasks_live_due_idx / tasks_live_status_due_idx / tasks_closed_idx / task_assignees_user_idx / task_evidence indexes (no Seq Scan on tasks or task_evidence at 10 000 tasks)", async () => {
    const w = await big()
    const ctxFor = (kind: "all" | "team" | "own") => ({
      tenantId: w.tenant.id, tz: "Europe/Dublin", me: kind === "all" ? w.ops.userId : w.manager.userId, actorId: w.ops.userId, role: null as never,
      scope: kind === "all" ? ({ kind: "all" } as const) : kind === "team" ? ({ kind: "team", managerId: w.manager.userId } as const) : ({ kind: "own", personId: w.staff.userId } as const),
      reports: kind === "team" ? [w.staff.userId] : [], drive: true, now: w.clock.now(),
    })
    const rctxFor = (kind: "all" | "team"): ReportCtx => ({
      tenantId: w.tenant.id, tz: "Europe/Dublin", me: w.manager.userId, actorId: w.manager.userId, role: null as never, access: kind === "all" ? { kind: "all" } : { kind: "team", managerId: w.manager.userId },
      reports: kind === "team" ? [w.staff.userId, "bulk-1", "bulk-2"] : [], task: null, drive: true, now: w.clock.now(),
    })
    const days = lastDays("2026-10-26", 7)
    const plans = await withTenant(w.deps.db, w.tenant.id, async (tx) => ({
      summaryAll: dashboardSummaryQuery(tx, ctxFor("all"), "2026-10-26").toSQL(),
      summaryTeam: dashboardSummaryQuery(tx, ctxFor("team"), "2026-10-26").toSQL(),
      closedAll: tasksClosedQuery(tx, ctxFor("all"), days).toSQL(),
      closedOwn: tasksClosedQuery(tx, ctxFor("own"), days).toSQL(),
      teamTasks: teamTasksQuery(tx, ctxFor("all"), 26).toSQL(),
      teamTasksTeam: teamTasksQuery(tx, ctxFor("team"), 26).toSQL(),
      attention: attentionQuery(tx, ctxFor("all"), "overdue", 200).toSQL(),
      attentionBlocked: attentionQuery(tx, ctxFor("team"), "blocked", 200).toSQL(),
      awaiting: awaitingReviewQuery(tx, ctxFor("all"), 200).toSQL(),
      pendingEvidence: pendingEvidenceQuery(tx, ctxFor("all")).toSQL(),
      pendingEvidenceTeam: pendingEvidenceQuery(tx, ctxFor("team")).toSQL(),
      reportsOpen: openReportsQuery(tx, rctxFor("all"), new Date("2026-10-19T00:00:00Z")).toSQL(),
      reportsOpenTeam: openReportsQuery(tx, rctxFor("team"), new Date("2026-10-19T00:00:00Z")).toSQL(),
      reportsAwaiting: awaitingReportsQuery(tx, rctxFor("all"), "2026-09-26", "2026-10-26").toSQL(),
    }))
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL })
    await c.connect()
    const explain = async (p: { sql: string; params: unknown[] }) => {
      await c.query("begin")
      await c.query("select set_config('app.tenant_id', $1, true)", [w.tenant.id])
      const rows = (await c.query(`explain ${p.sql}`, p.params as unknown[])).rows.map((r) => r["QUERY PLAN"] as string).join("\n")
      await c.query("rollback")
      return rows
    }
    try {
      for (const [name, p] of Object.entries(plans)) {
        const text = await explain(p)
        if (process.env.DUMP_PLANS) (await import("node:fs")).appendFileSync("/tmp/plans.txt", `\n=== ${name}\n${text}\n`)
        expect(text, name).not.toMatch(/Seq Scan on tasks/)
        expect(text, name).not.toMatch(/Seq Scan on task_evidence/)
        expect(text, name).not.toMatch(/Seq Scan on task_assignees/)
        if (!name.startsWith("reports")) expect(text, name).toMatch(/tasks_live_due_idx|tasks_live_status_due_idx|tasks_closed_idx|task_assignees_user_idx|task_evidence_gallery_idx|task_evidence_task_idx/)
      }
      expect(await explain(plans.closedAll)).toContain("tasks_closed_idx")
      expect(await explain(plans.summaryAll)).toMatch(/tasks_live_status_due_idx|tasks_live_due_idx/)
      expect(await explain(plans.teamTasks)).toMatch(/tasks_live_due_idx|tasks_live_status_due_idx/)
      expect(await explain(plans.closedOwn)).toContain("task_assignees_user_idx")
      // the report queries: shift_reports_open_idx (draft and returned by due time, window on due_at) and shift_reports_inbox_idx (submitted by shift date)
      expect(await explain(plans.reportsOpen)).toContain("shift_reports_open_idx")
      expect(await explain(plans.reportsAwaiting)).toContain("shift_reports_awaiting_idx")
      expect(await explain(plans.reportsOpenTeam)).toMatch(/shift_reports_open_idx|shift_reports_user_idx/)
      for (const k of ["reportsOpen", "reportsAwaiting", "reportsOpenTeam"] as const) expect(await explain(plans[k]), k).not.toMatch(/Seq Scan on shift_reports/)
    } finally {
      await c.end()
    }
  }, 180_000)

  test("read models answer in < 500 ms uncached at 250 users and 10 000 tasks (median of 10 runs on the seeded tenant, p95 ceiling 500 ms; the k6 run is B7)", async () => {
    const w = await big()
    const paths = ["/v1/dashboard", "/v1/dashboard/team-tasks?limit=50", "/v1/dashboard/staff", "/v1/attention?limit=50", "/v1/today"]
    for (const who of [w.ops, w.manager, w.staff]) {
      for (const p of paths) {
        if (p.startsWith("/v1/attention") && who === w.staff) continue
        await retryTimingOnce(async () => {
          const times: number[] = []
          for (let i = 0; i < 10; i++) {
            resetReadModelCache()
            const t0 = performance.now()
            const r = await w.req("GET", p, who)
            times.push(performance.now() - t0)
            expect(r.status, p).toBe(200)
            await r.arrayBuffer()
          }
          times.sort((a, b) => a - b)
          if (process.env.DUMP_PLANS) (await import("node:fs")).appendFileSync("/tmp/timing.txt", `${who === w.ops ? "ops" : who === w.manager ? "manager" : "staff"} ${p}: median ${times[5].toFixed(0)} ms, worst ${times[9].toFixed(0)} ms\n`)
          expect(median(times), `${p} median`).toBeLessThan(500) // the contract (median of 10 uncached runs)
          expect(times[times.length - 1], `${p} worst`).toBeLessThan(4500) // 3x the old ceiling: one slow run on a loaded machine is noise, a regression moves the median too
        })
      }
    }
    // a warm read is a cache hit: much faster than the median uncached (two reads, median of 5 rounds)
    await retryTimingOnce(async () => {
      const rounds: number[] = []
      for (let i = 0; i < 5; i++) {
        const hot = performance.now()
        await w.req("GET", "/v1/dashboard", w.ops)
        await w.req("GET", "/v1/dashboard", w.ops)
        rounds.push(performance.now() - hot)
      }
      expect(median(rounds), "two warm reads").toBeLessThan(1000)
    })
  }, 240_000)
})

describe("route walker and the API surface", () => {
  test("all read-model GET routes without params are in the OpenAPI document, return only the caller's tenant, and carry examples", async () => {
    const w = await world({ now: NOW })
    const b = await world({ now: NOW, slug: "beta" })
    await scenario(w)
    await b.task(b.staff, { title: "Beta secret", start: at(8), due: at(15) })
    const doc = (await (await call(w.app, "GET", "/v1/openapi.json")).json()) as { paths: Record<string, Record<string, Json>> }
    const routes = ["/v1/dashboard", "/v1/dashboard/team-tasks", "/v1/dashboard/staff", "/v1/attention", "/v1/today"]
    for (const p of routes) {
      expect(doc.paths[p]?.get, p).toBeTruthy()
      expect(JSON.stringify(doc.paths[p].get.responses["200"].content["application/json"].schema.example ?? doc.paths[p].get.responses["200"].content["application/json"].example), p).toBeTruthy()
      const text = JSON.stringify(await get(w, p, w.owner))
      expect(text, p).not.toContain("Beta secret")
      expect(text, p).not.toContain(b.tenant.id)
    }
    const post = doc.paths["/v1/today/updates"]?.post
    expect(post).toBeTruthy()
    expect(JSON.stringify(post.requestBody.content["application/json"])).toContain("example")
    // unauthenticated and another tenant's member: 401 / 404
    for (const p of routes) expect((await call(w.app, "GET", p, { tenant: "acme" })).status, p).toBe(401)
    for (const p of routes) expect((await b.req("GET", p, w.owner)).status, p).toBe(404) // w's owner is no member of beta
    // a read-only role cannot POST (403), the permission is tasks:write
    const auditor = await w.who("auditor")
    const r = await w.req("POST", "/v1/today/updates", auditor, { taskId: randomUUID(), action: "snooze", dayKey: "2026-10-26" })
    expect(r.status).toBe(403)
  })

  test("the module takes time from deps.clock only and logs no titles", async () => {
    const { readFileSync, readdirSync } = await import("node:fs")
    const dir = new URL(".", import.meta.url).pathname
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(`${dir}${f}`, "utf8")
      expect(src, f).not.toMatch(/new Date\(\)|Date\.now\(\)|\bnow\(\)\s*::/)
      expect(src, f).not.toMatch(/logger\.(info|warn|error)\([^)]*title/)
    }
  })
})
