import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import { call, resetDb } from "../../../test/harness"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 10, Review Focus 2: the publish lock, as a matrix (role level x week state x action) and as an inventory of the live OpenAPI document,
// so a new roster route that carries a week or a shift fails here until it has a case.

type W = Awaited<ReturnType<typeof sites>>
type Cell = { weekId: string; start: string; shiftId: string; shiftVersion: number }
type Role = "supervisor" | "office" | "manager" | "staff"
type Action = "add" | "move" | "remove" | "publish" | "confirm" | "check" | "changeRequest"

/** The one request of each action, as a function of the caller and the cell (`reason` goes where the route takes one). */
const RUN: Record<Action, (w: W, who: Who, c: Cell, reason?: string) => Promise<Response>> = {
  add: (w, who, c, reason) => w.add(who, c.weekId, [{ date: c.start, userIds: [null], shiftTypeId: w.ta }], reason ? { reason } : {}),
  move: (w, who, c, reason) => w.req("PATCH", `/v1/roster/shifts/${c.shiftId}`, who, { version: c.shiftVersion, patch: { start: "09:00", end: "17:00" }, ...(reason ? { reason } : {}) }),
  remove: (w, who, c, reason) => w.req("DELETE", `/v1/roster/shifts/${c.shiftId}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`, who),
  publish: async (w, who, c) => w.req("POST", `/v1/roster/weeks/${c.weekId}/publish`, who, { version: Number((await w.rows("select version from roster_weeks where id = $1", [c.weekId]))[0].version) }),
  confirm: (w, who, c) => w.req("POST", `/v1/roster/shifts/${c.shiftId}/confirm`, who),
  check: (w, who, c) => w.req("POST", `/v1/roster/weeks/${c.weekId}/check`, who),
  changeRequest: (w, who, c, reason) => w.req("POST", `/v1/roster/shifts/${c.shiftId}/change-requests`, who, { patch: { start: "09:00", end: "17:00" }, ...(reason ? { reason } : {}) }),
}

/** route key of the live document -> the action that exercises it. A new mutating route with a week or shift in its path fails the inventory test until it is listed here. */
const ROUTE_ACTION: Record<string, Action> = {
  "POST /v1/roster/weeks/{id}/shifts": "add",
  "PATCH /v1/roster/shifts/{id}": "move",
  "DELETE /v1/roster/shifts/{id}": "remove",
  "POST /v1/roster/weeks/{id}/publish": "publish",
  "POST /v1/roster/shifts/{id}/confirm": "confirm",
  "POST /v1/roster/weeks/{id}/check": "check", // a dry run: writes nothing
  "POST /v1/roster/shifts/{id}/change-requests": "changeRequest", // the supervisor's way into a published week: a request, never an edit (Task 11)
}

/** [draft, published without reason, published with reason] per role. null = not applicable (the action takes no reason). */
const EXPECT: Record<Action, Record<Role, [number, number | null, number | null]>> = {
  add: { supervisor: [201, 403, 403], office: [201, 422, 201], manager: [403, 403, 403], staff: [403, 403, 403] },
  move: { supervisor: [200, 403, 403], office: [200, 422, 200], manager: [403, 403, 403], staff: [403, 403, 403] },
  remove: { supervisor: [204, 403, 403], office: [204, 422, 204], manager: [403, 403, 403], staff: [403, 403, 403] },
  publish: { supervisor: [200, 409, null], office: [200, 409, null], manager: [403, 403, null], staff: [403, 403, null] },
  confirm: { supervisor: [403, 403, null], office: [403, 403, null], manager: [403, 403, null], staff: [409, 200, null] },
  check: { supervisor: [200, 200, null], office: [200, 200, null], manager: [403, 403, null], staff: [403, 403, null] },
  changeRequest: { supervisor: [409, 422, 201], office: [409, 422, 201], manager: [403, 403, 403], staff: [403, 403, 403] }, // a draft week is edited directly; a request always needs its reason
}

let n = 0
const MONDAYS = Array.from({ length: 80 }, (_, i) => new Date(Date.UTC(2027, 1, 1 + i * 7)).toISOString().slice(0, 10))

beforeEach(resetDb)

/** A fresh week at Alpha with the employee on a shift, in the wanted state. */
async function cell(w: W, state: "draft" | "published"): Promise<Cell> {
  const start = MONDAYS[n++]
  const weekId = await w.week(w.p.owner, w.a, start)
  const added = await w.addOk(w.p.owner, weekId, [{ date: start, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
  if (state === "published") {
    const v = Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
    await w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version: v })
  }
  return { weekId, start, shiftId: added.shifts[0].id, shiftVersion: added.shifts[0].version }
}

const who = (w: W, r: Role): Who => ({ supervisor: w.p["location-supervisor"], office: w.p.owner, manager: w.p.manager, staff: w.p.employee })[r]

describe("the publish lock matrix (AC-RS-05, Review Focus 2)", () => {
  test("every action x role x week state answers the documented status; a supervisor never gets 200 on a published week except the person's own confirm", async () => {
    const w = await sites()
    const failures: string[] = []
    for (const action of Object.keys(RUN) as Action[]) {
      for (const role of ["supervisor", "office", "manager", "staff"] as Role[]) {
        const [draft, pubNoReason, pubReason] = EXPECT[action][role]
        // the add and edit cells at the same caller must use a different week each time: a refused call leaves its cell untouched, a successful one is spent
        const c1 = await cell(w, "draft")
        const r1 = await RUN[action](w, who(w, role), c1)
        if (r1.status !== draft) failures.push(`${action} ${role} draft: ${r1.status} want ${draft} ${await r1.text()}`)
        const c2 = await cell(w, "published")
        const r2 = await RUN[action](w, who(w, role), c2)
        if (r2.status !== pubNoReason) failures.push(`${action} ${role} published (no reason): ${r2.status} want ${pubNoReason} ${await r2.text()}`)
        if (pubReason !== null) {
          const c3 = await cell(w, "published")
          const r3 = await RUN[action](w, who(w, role), c3, "Venue request")
          if (r3.status !== pubReason) failures.push(`${action} ${role} published (reason): ${r3.status} want ${pubReason} ${await r3.text()}`)
        }
      }
    }
    expect(failures).toEqual([])
  }, 300_000)

  test("a supervisor over a published week: the refusal is the lock (roster_locked) on every edit and writes nothing", async () => {
    const w = await sites()
    const c = await cell(w, "published")
    const before = await w.rows("select id, version, start_time, user_id, confirmed_at from roster_shifts order by id")
    const wkBefore = await w.rows("select id, version, status from roster_weeks order by id")
    const hist = (await w.rows("select 1 from roster_history")).length
    for (const action of ["add", "move", "remove"] as const) {
      for (const reason of [undefined, "Because I said so"]) {
        const r = await RUN[action](w, w.p["location-supervisor"], c, reason)
        expect([r.status, ((await r.json()) as Json).code], `${action} ${reason}`).toEqual([403, "roster_locked"])
      }
    }
    expect(await w.rows("select id, version, start_time, user_id, confirmed_at from roster_shifts order by id")).toEqual(before)
    expect(await w.rows("select id, version, status from roster_weeks order by id")).toEqual(wkBefore)
    expect((await w.rows("select 1 from roster_history")).length).toBe(hist)
  })

  test("an office role limited by an except list is still office for its own sites (edits with a reason), and a site it is cut from is 404", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    const c = await cell(w, "published")
    expect((await RUN.move(w, w.p["roster-manager"], c, undefined)).status).toBe(422)
    expect((await RUN.move(w, w.p["roster-manager"], c, "Reason")).status).toBe(200)
    const hidden = await w.addOk(w.p.owner, w.wb, [{ date: "2026-11-02", userIds: [w.staff2.userId], shiftTypeId: w.tb }])
    const r = await w.req("PATCH", `/v1/roster/shifts/${hidden.shifts[0].id}`, w.p["roster-manager"], { version: 1, patch: { start: "09:00" }, reason: "x" })
    expect([r.status, ((await r.json()) as Json).code]).toEqual([404, "not_found"])
  })
})

describe("inventory of the live OpenAPI document (a new route fails until it has a case)", () => {
  let doc: { paths: Record<string, Record<string, unknown>> }
  beforeAll(async () => {
    await resetDb()
    const w = await sites()
    doc = (await (await call(w.app, "GET", "/v1/openapi.json")).json()) as typeof doc
  }, 120_000)

  test("every mutating roster route that carries a week or a shift is in the matrix", () => {
    const live = Object.entries(doc.paths)
      .filter(([path]) => /^\/v1\/roster\/(weeks|shifts)\/\{/.test(path))
      .flatMap(([path, item]) => ["post", "put", "patch", "delete"].filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`))
    expect(live.length).toBeGreaterThanOrEqual(Object.keys(ROUTE_ACTION).length)
    expect(live.filter((k) => !(k in ROUTE_ACTION)).map((k) => `${k}: add a case to lock-matrix.test.ts (ROUTE_ACTION and EXPECT)`)).toEqual([])
    expect(Object.keys(ROUTE_ACTION).filter((k) => !live.includes(k)).map((k) => `stale case ${k}`)).toEqual([])
  })
})
