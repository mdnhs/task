import { beforeAll, describe, expect, test } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { call, resetDb } from "./harness"
import { ownerQuery } from "./db"
import { makeStaff, signIn } from "./factories"
import { world, type Json, type Who } from "../src/modules/rosters/testkit"
import { HASHED_TABLES } from "./isolation-tables"
import { ROUTE_CLASSIFICATION } from "./route-classification"

/**
 * B8 Task 26, Review Focus 1: a location supervisor, an office roster manager with an except list, a staff member and a platform user
 * each hit EVERY GET route (the ids and filters of the other location in the path and query) and no body, in any role, contains a string
 * of the other location (name, address, ids of its weeks, shifts, types, requests, exchanges, leave, history reasons, its people).
 * The matrix is symmetric: the supervisor and the staff member of Bravo are checked against Alpha's strings too.
 * Routes are taken from the live OpenAPI document, so a new GET route is in the matrix without anyone editing this file.
 */
beforeAll(resetDb, 120_000)

const WK = "2026-11-23" // a Monday after the fake clock (2026-11-16)
const NIL = "00000000-0000-4000-8000-000000000000"

type Seed = Awaited<ReturnType<typeof seed>>

async function seed() {
  const w = await world()
  const a = ((await w.ok("POST", "/v1/locations", w.p.owner, { name: "Harbour Alpha", address: "1 Alpha Quay" }, 201)) as Json).id as string
  const b = ((await w.ok("POST", "/v1/locations", w.p.owner, { name: "Quarry Zebra", address: "9 Zebra Quarry Road" }, 201)) as Json).id as string
  await w.ok("PUT", `/v1/locations/${a}/supervisors`, w.p.owner, { userIds: [w.p["location-supervisor"].userId] })
  await w.ok("PUT", `/v1/locations/${b}/supervisors`, w.p.owner, { userIds: [w.sup2.userId] })
  // Alpha people: employee, Cian (staff2). Bravo people: Dara (staff3) and the supervisor of Bravo
  await w.ok("PUT", `/v1/members/${w.p.employee.userId}/home-location`, w.p.owner, { locationId: a })
  await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: a })
  await w.ok("PUT", `/v1/members/${w.staff3.userId}/home-location`, w.p.owner, { locationId: b })
  await w.ok("PUT", `/v1/members/${w.sup2.userId}/home-location`, w.p.owner, { locationId: b })
  await ownerQuery(`update "user" set name = 'Zebra Dara' where id = $1`, [w.staff3.userId])
  await ownerQuery(`update "user" set name = 'Zebra Supervisor' where id = $1`, [w.sup2.userId])
  await ownerQuery(`update "user" set name = 'Alpine Aoife' where id = $1`, [w.p.employee.userId])
  await ownerQuery(`update "user" set name = 'Alpine Supervisor' where id = $1`, [w.p["location-supervisor"].userId])
  // the office roster manager is cut: every site except Bravo
  await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [b] })
  const ta = await w.type(a, "Alpine Day")
  const tb = await w.type(b, "Zebra Night", { requires: ["zebra-licence"] })
  await w.ok("PUT", `/v1/members/${w.staff3.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "zebra-licence", expiresOn: "2027-06-30" }] })
  await w.ok("PUT", `/v1/members/${w.sup2.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "zebra-licence", expiresOn: "2027-06-30" }] })
  const wa = await w.week(w.p.owner, a, WK)
  const wb = await w.week(w.p.owner, b, WK)
  const sa = (await w.addOk(w.p.owner, wa, [{ date: WK, userIds: [w.p.employee.userId, null], shiftTypeId: ta }, { date: "2026-11-24", userIds: [w.staff2.userId], shiftTypeId: ta }])).shifts as Json[]
  const sb = (await w.addOk(w.p.owner, wb, [{ date: WK, userIds: [w.staff3.userId, null], shiftTypeId: tb }, { date: "2026-11-24", userIds: [w.sup2.userId], shiftTypeId: tb }])).shifts as Json[]
  const publish = async (week: string) => {
    const v = ((await w.rows("select version from roster_weeks where id = $1", [week]))[0] as Json).version
    await w.ok("POST", `/v1/roster/weeks/${week}/publish`, w.p.owner, { version: v })
  }
  await publish(wa)
  await publish(wb)
  // office edit on a published week with a reason (history), a change request, a claim of the open shift, leave and availability, a saved template
  const bShift = sb.find((s) => s.userId === w.staff3.userId)!
  await w.ok("PATCH", `/v1/roster/shifts/${bShift.id}`, w.p.owner, { version: bShift.version, patch: { start: "09:00", end: "17:00" }, reason: "Zebra edit reason" })
  const bShift2 = sb.find((s) => s.userId === w.sup2.userId)!
  await w.ok("POST", `/v1/roster/shifts/${bShift2.id}/change-requests`, w.sup2, { patch: { start: "10:00", end: "18:00" }, reason: "Zebra change reason" }, 201)
  const bOpen = sb.find((s) => s.userId === null)!
  await w.ok("POST", `/v1/roster/shifts/${bOpen.id}/claim`, w.staff3, undefined, 201)
  const aOpen = sa.find((s) => s.userId === null)!
  await w.ok("POST", `/v1/roster/shifts/${aOpen.id}/claim`, w.staff2, undefined, 201)
  await w.ok("POST", `/v1/leave`, w.staff3, { from: "2026-12-07", to: "2026-12-09", kind: "annual", note: "Zebra leave note" }, 201)
  await w.ok("POST", `/v1/leave`, w.p.employee, { from: "2026-12-14", to: "2026-12-15", kind: "annual", note: "Alpine leave note" }, 201)
  await w.ok("PUT", `/v1/roster/availability`, w.staff3, { windows: [{ weekday: 1, from: "09:00", to: "12:00" }] })
  await w.ok("POST", `/v1/roster/weeks/${wb}/save-template`, w.p.owner, { name: "Zebra template" }, 201)
  await w.ok("POST", `/v1/roster/weeks/${wa}/save-template`, w.p.owner, { name: "Alpine template" }, 201)
  const ids = async (sql: string, params: unknown[]) => (await w.rows(sql, params)).map((r) => String(r.id))
  const bMarks = [
    b, "Quarry Zebra", "9 Zebra Quarry Road", wb, tb, "Zebra Night", ...sb.map((s) => String(s.id)), "Zebra edit reason", "Zebra change reason", "Zebra leave note", "Zebra template", "zebra-licence",
    ...(await ids("select id from roster_change_requests where requested_by = $1", [w.sup2.userId])),
    ...(await ids("select id from roster_exchanges where from_user_id = $1", [w.staff3.userId])),
    ...(await ids("select id from leave_requests where user_id = $1", [w.staff3.userId])),
    ...(await ids("select id from roster_week_templates where location_id = $1", [b])),
    "Zebra Dara", "Zebra Supervisor", w.staff3.userId, w.staff3.email, w.sup2.userId, w.sup2.email,
  ]
  const aMarks = [
    a, "Harbour Alpha", "1 Alpha Quay", wa, ta, "Alpine Day", ...sa.map((s) => String(s.id)), "Alpine leave note", "Alpine template",
    ...(await ids("select id from roster_exchanges where from_user_id = $1", [w.staff2.userId])),
    ...(await ids("select id from leave_requests where user_id = $1", [w.p.employee.userId])),
    ...(await ids("select id from roster_week_templates where location_id = $1", [a])),
    "Alpine Aoife", "Alpine Supervisor", w.p.employee.userId, w.p.employee.email, w.p["location-supervisor"].userId, w.p["location-supervisor"].email, w.staff2.userId, w.staff2.email,
  ]
  const staffUser = await makeStaff(w.deps, "support")
  const staffCookie = (await signIn(w.app, staffUser.email, staffUser.password)).cookie
  return { w, a, b, wa, wb, sa, sb, ta, tb, aMarks, bMarks, staffCookie: staffUser.cookie ?? staffCookie, staffUser }
}

let s: Seed
let doc: { paths: Record<string, Record<string, Json>> }
beforeAll(async () => {
  s = await seed()
  doc = (await (await call(s.w.app, "GET", "/v1/openapi.json")).json()) as typeof doc
}, 180_000)

/** What the roster surfaces and the identity of people may show: the directory of the tenant (people, members, audit) is not a roster route and is outside this matrix's person check. */
const ROSTER_PATH = /^\/v1\/(roster|locations|leave|shift-types|notifications|attention|dashboard|today|me\/)/

/**
 * Known and documented, NOT fixed in B8 (follow-ups doc, "Audit scope"): the tenant audit log is a tenant-wide security view behind `audit:read`.
 * The Roster Manager template carries audit:read, so an office manager cut by an except list still reads the roster audit lines (location name, reasons,
 * shift ids) of the excepted site there. A supervisor and staff have no audit access. The test below pins this so a later fix flips it.
 */
const AUDIT_PATHS = new Set(["/v1/audit", "/v1/audit/export"])

type Actor = { name: string; who?: Who; staff?: boolean; against: "a" | "b" }

/** Every GET operation, once with no filter and once per hostile filter (the other location's ids in query and path). */
function targets(other: "a" | "b") {
  const O = other === "a" ? { loc: s.a, week: s.wa, shift: String(s.sa[0].id), person: s.w.p.employee.userId } : { loc: s.b, week: s.wb, shift: String(s.sb[0].id), person: s.w.staff3.userId }
  const out: { key: string; url: string }[] = []
  for (const [path, item] of Object.entries(doc.paths)) {
    const op = item.get as Json | undefined
    if (!op || path.startsWith("/v1/platform/") || AUDIT_PATHS.has(path)) continue
    const fill = (p: string) =>
      path.replace(/\{(\w+)\}/g, (_, name) => {
        if (path.startsWith("/v1/locations/") && name === "id") return O.loc
        if (path.startsWith("/v1/roster/weeks/") && name === "id") return O.week
        if (name === "userId") return O.person
        return p
      })
    const query = ((op.parameters ?? []) as Json[]).filter((x) => x.in === "query").map((x) => x.name as string)
    const variants: string[] = [""]
    const hostile: string[] = []
    for (const q of query) {
      if (q === "locationId") hostile.push(`locationId=${O.loc}`)
      if (q === "userId") hostile.push(`userId=${O.person}`)
      if (q === "shiftId") hostile.push(`shiftId=${O.shift}`)
      if (q === "teamId") hostile.push(`teamId=${O.loc}`)
    }
    if (query.includes("from")) hostile.push(`from=2026-11-23&view=month`)
    variants.push(...hostile)
    if (hostile.length > 1) variants.push(hostile.filter((h) => !h.startsWith("from")).join("&"))
    for (const v of new Set(variants)) out.push({ key: `GET ${path}${v ? `?${v}` : ""}`, url: `${fill(NIL)}${v ? `?${v}` : ""}` })
  }
  return out
}

describe("Review Focus 1 cross-role matrix over the final routes (4 roles x all GET routes, 2 locations): no other-location string in any body", () => {
  const actors = (): Actor[] => [
    { name: "location supervisor of Alpine/Harbour Alpha", who: s.w.p["location-supervisor"], against: "b" },
    { name: "office roster manager cut to every site except Zebra", who: s.w.p["roster-manager"], against: "b" },
    { name: "staff member homed at Alpha", who: s.w.p.employee, against: "b" },
    { name: "location supervisor of Zebra", who: s.w.sup2, against: "a" },
    { name: "staff member homed at Zebra", who: s.w.staff3, against: "a" },
    { name: "platform staff without a grant", staff: true, against: "b" },
  ]
  test("no body, status or header of any GET route (path ids and filters of the other location, 6 callers) carries the other location's strings; no 5xx", async () => {
    const failures: string[] = []
    let calls = 0
    let ownHits = 0
    for (const actor of actors()) {
      const marks = actor.against === "b" ? s.bMarks : s.aMarks
      const own = actor.against === "b" ? s.aMarks : s.bMarks
      for (const t of targets(actor.against)) {
        const rosterPath = ROSTER_PATH.test(t.key.slice(4))
        const r = actor.staff
          ? await call(s.w.app, "GET", t.url, { cookie: s.staffCookie, tenant: "acme" })
          : await s.w.req("GET", t.url, actor.who!)
        const text = await r.text()
        const head = JSON.stringify([...r.headers.entries()])
        calls++
        if (r.status >= 500) failures.push(`${actor.name}: ${t.key} -> ${r.status}`)
        // the directory (people, members, audit, tasks ...) is tenant wide by design: only a LOCATION string must never appear there; person identity is checked on roster surfaces
        const set = rosterPath ? marks : marks.filter((m) => !personMark(m))
        for (const m of set) if (text.includes(m) || head.includes(m)) failures.push(`${actor.name}: ${t.key} -> ${r.status} leaks "${m}"`)
        if (r.status === 200 && own.some((m) => text.includes(m))) ownHits++
      }
    }
    expect(calls).toBeGreaterThan(300)
    expect(ownHits, "the matrix is not vacuous: callers do get their own site's strings").toBeGreaterThan(5)
    expect(failures).toEqual([])
  }, 300_000)

  test("audit scope (documented gap): supervisors and staff get 403 on the audit log; the cut office manager reads it (audit:read is tenant wide)", async () => {
    for (const who of [s.w.p["location-supervisor"], s.w.p.employee, s.w.sup2, s.w.staff3]) expect((await s.w.req("GET", "/v1/audit", who)).status).toBe(403)
    const r = await s.w.req("GET", "/v1/audit?actionPrefix=roster.", s.w.p["roster-manager"])
    expect(r.status).toBe(200)
    expect(await r.text()).toContain("Quarry Zebra") // the gap: flip this when audit rows are cut by roster scope (follow-up)
  })

  const personMark = (m: string) => [s.w.staff3.userId, s.w.staff3.email, s.w.sup2.userId, s.w.sup2.email, s.w.p.employee.userId, s.w.p.employee.email, s.w.p["location-supervisor"].userId, s.w.p["location-supervisor"].email, s.w.staff2.userId, s.w.staff2.email, "Zebra Dara", "Zebra Supervisor", "Alpine Aoife", "Alpine Supervisor"].includes(m)

  test("controls: a supervisor reads their own site and gets the same 404 for Bravo's week, location, history and listing filter as for ids that never existed", async () => {
    const sup = s.w.p["location-supervisor"]
    for (const ok of [`/v1/locations/${s.a}`, `/v1/roster/weeks/${s.wa}`, `/v1/roster/weeks?locationId=${s.a}&from=${WK}`]) expect((await s.w.req("GET", ok, sup)).status, ok).toBe(200)
    const code = async (url: string) => {
      const r = await s.w.req("GET", url, sup)
      return [r.status, ((await r.json()) as Json).code]
    }
    for (const [hidden, ghost] of [[`/v1/locations/${s.b}`, `/v1/locations/${NIL}`], [`/v1/roster/weeks/${s.wb}`, `/v1/roster/weeks/${NIL}`], [`/v1/roster/weeks/${s.wb}/history`, `/v1/roster/weeks/${NIL}/history`], [`/v1/locations/${s.b}/history`, `/v1/locations/${NIL}/history`], [`/v1/locations/${s.b}/shift-types`, `/v1/locations/${NIL}/shift-types`], [`/v1/roster/weeks?locationId=${s.b}`, `/v1/roster/weeks?locationId=${NIL}`], [`/v1/roster/coverage?locationId=${s.b}`, `/v1/roster/coverage?locationId=${NIL}`], [`/v1/roster/change-requests?locationId=${s.b}`, `/v1/roster/change-requests?locationId=${NIL}`]]) {
      expect(await code(hidden), hidden).toEqual(await code(ghost))
      expect((await code(hidden))[0], hidden).toBe(404)
    }
  })
})

describe("isolation: every roster, leave, location, shift-type, change-request and exchange path answers tenant B's id with 404 and tenant B's row hashes are unchanged after the walk (HASHED_TABLES includes all new tables)", () => {
  const migrations = join(import.meta.dirname, "../src/db/migrations")
  const b8 = readdirSync(migrations).filter((f) => /^004[3-9].*\.sql$/.test(f))

  test("the hashed list covers every table created by migrations 0043 to 0049 (derived from the SQL, not from memory)", () => {
    const created = b8.flatMap((f) => [...readFileSync(join(migrations, f), "utf8").matchAll(/CREATE TABLE "(\w+)"/gi)].map((m) => m[1]))
    expect(b8.length).toBe(7)
    expect(created.length).toBeGreaterThanOrEqual(16)
    expect(created.filter((t) => !HASHED_TABLES.includes(t))).toEqual([])
  })

  test("every B8 route is classified, and every B8 route with a tenant record id is a tenant-record route walked by isolation.test.ts", () => {
    const b8Routes = Object.keys(doc.paths).flatMap((p) => Object.keys(doc.paths[p]).filter((m) => ["get", "put", "post", "patch", "delete"].includes(m)).map((m) => `${m.toUpperCase()} ${p}`)).filter((k) => /\/v1\/(roster|locations|leave|shift-types)|qualifications|home-location|deactivate|reactivate/.test(k))
    expect(b8Routes.length).toBeGreaterThan(50)
    expect(b8Routes.filter((k) => !ROUTE_CLASSIFICATION[k])).toEqual([])
    const withId = b8Routes.filter((k) => /\{(id|userId)\}/.test(k))
    expect(withId.filter((k) => ROUTE_CLASSIFICATION[k]?.[0] !== "tenant-record" && !k.includes("device-policies"))).toEqual([])
  })

  test("OpenAPI examples present for every new body: each B8 JSON request body carries an example", () => {
    const missing: string[] = []
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!/\/v1\/(roster|locations|leave|shift-types)|qualifications|home-location|deactivate|reactivate/.test(path)) continue
      for (const m of ["put", "post", "patch", "delete"]) {
        const op = item[m] as Json | undefined
        const schema = op?.requestBody?.content?.["application/json"]?.schema as Json | undefined
        if (op?.requestBody && (schema?.example ?? schema?.examples?.[0]) === undefined) missing.push(`${m.toUpperCase()} ${path}`)
      }
    }
    expect(missing).toEqual([])
  })
})
