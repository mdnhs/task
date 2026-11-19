import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const jar = new Map<string, string>()
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), getAll: () => [...jar].map(([name, value]) => ({ name, value })) }),
  headers: async () => new Headers({ "x-tenant": "evil-header", "user-agent": "test" }),
}))

const mfa = vi.hoisted(() => ({ ok: true }))
vi.mock("@/lib/session", () => ({ requireMfaOk: async () => { if (!mfa.ok) throw Object.assign(new Error("NEXT_REDIRECT"), { url: "/mfa" }); return {} } }))

import * as actions from "@/app/actions/rosters"
import { LID, SHIFT_ID, WEEK_ID, UID, shiftDto, weekDto, violationDto, changeRequestDto, exchangeDto, leaveDto, locationDto } from "@/features/rosters/fixtures"

type Seen = { method: string; path: string; query: string; tenant: string | null; origin: string | null; ifMatch: string | null; body: unknown }
let seen: Seen[]
let answer: (path: string, method: string) => Response
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } })
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ status, code, requestId: "req-9", ...extra }), { status, headers: { "content-type": "application/problem+json" } })

beforeEach(() => {
  jar.clear(); seen = []; mfa.ok = true
  jar.set("better-auth.session_token", "tok")
  jar.set("od-tenant", "northgate")
  vi.stubEnv("API_URL", "http://api.internal:3001"); vi.stubEnv("APP_ORIGIN", "https://app.example.com")
  answer = () => json({})
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const h = new Headers(init.headers)
    const method = init.method ?? "GET"
    seen.push({ method, path: u.pathname, query: u.search, tenant: h.get("x-tenant"), origin: h.get("origin"), ifMatch: h.get("if-match"), body: init.body ? JSON.parse(String(init.body)) : undefined })
    return answer(u.pathname, method)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("roster server actions", () => {
  test("server action never forwards a client-supplied X-Tenant (I5)", async () => {
    answer = () => json({ shift: shiftDto, violations: [] })
    // a hostile argument carrying a tenant or headers is not read; the header comes from the httpOnly cookie, and the incoming request's own x-tenant is never forwarded
    await actions.patchShift(SHIFT_ID, { version: 1, patch: { start: "09:00" }, tenant: "evil-arg", headers: { "x-tenant": "evil-arg" }, "x-tenant": "evil-arg" } as never)
    expect(seen[0]!.tenant).toBe("northgate")
    expect(seen[0]!.origin).toBe("https://app.example.com")
    const src = readFileSync("app/actions/rosters.ts", "utf8")
    expect(src).not.toMatch(/x-tenant|TENANT_HEADER|apiServer\(\s*\{/i)
  })

  test("patchShift sends the version it was given and returns the API's shift with its NEW version and the violations (AI2 #4)", async () => {
    answer = () => json({ shift: { ...shiftDto, start: "09:00", version: 5 }, violations: [violationDto] })
    const r = await actions.patchShift(SHIFT_ID, { version: 4, patch: { start: "09:00" } })
    expect(seen[0]!.body).toEqual({ version: 4, patch: { start: "09:00" } })
    expect(r.ok && r.value.shift.version).toBe(5) // the answer's version, never the one sent plus one
    expect(r.ok && r.value.shift.start).toBe("09:00")
    expect(r.ok && r.value.violations.map((v) => v.rule)).toEqual(["daily_rest"])
    answer = () => problem(409, "version_conflict")
    expect(await actions.patchShift(SHIFT_ID, { version: 4, patch: { start: "10:00" } })).toMatchObject({ ok: false, error: { state: "conflict" } })
  })

  test("reloadRoster reads the week again for the range on screen (a read, after the MFA check)", async () => {
    answer = (path) => (path === "/v1/locations" ? json({ items: [locationDto] }) : json({ range: { from: "2026-11-02", to: "2026-11-08", view: "week" }, weeks: [weekDto], shifts: [shiftDto], shiftTypes: [], members: [], membersTruncated: false, access: { level: "supervisor", canEdit: true, locked: false, lockReason: null } }))
    const r = await actions.reloadRoster({ locationId: LID, from: "2026-11-02", view: "week" })
    expect(r.ok && r.value.weeks[0]!.access.canEdit).toBe(true)
    expect(seen.find((c) => c.path === "/v1/roster/weeks")!.query).toContain(`locationId=${LID}`)
    expect(seen.every((c) => c.method === "GET")).toBe(true)
  })

  test("deleteShift always sends the version (and the reason)", async () => {
    answer = () => new Response(null, { status: 204 })
    const r = await actions.deleteShift(SHIFT_ID, { version: 4, reason: "Cover found" })
    expect(r.ok).toBe(true)
    expect(seen[0]).toMatchObject({ method: "DELETE", path: `/v1/roster/shifts/${SHIFT_ID}` })
    expect(new URLSearchParams(seen[0]!.query).get("version")).toBe("4")
    expect(new URLSearchParams(seen[0]!.query).get("reason")).toBe("Cover found")
  })

  test("decide sends overrideReason and overrideRuleIds; the approved shift comes back mapped", async () => {
    answer = () => json({ request: { ...changeRequestDto, status: "approved" }, shift: shiftDto, violations: [violationDto] })
    const r = await actions.decideChange("cr-1", { decision: "approve", note: "ok", overrideReason: "Client asked", overrideRuleIds: ["double_booking"] })
    expect(seen[0]!.body).toEqual({ decision: "approve", note: "ok", overrideReason: "Client asked", overrideRuleIds: ["double_booking"] })
    expect(r.ok && r.value.shift?.personId).toBe(UID)
    expect(r.ok && r.value.violations[0]!.rule).toBe("daily_rest")
    answer = () => json({ exchange: { ...exchangeDto, status: "approved" }, shift: null, violations: [] })
    const x = await actions.decideExchange("ex-1", { decision: "approve", overrideReason: "r", overrideRuleIds: ["left"] })
    expect(seen[1]!.body).toMatchObject({ overrideRuleIds: ["left"] })
    expect(x.ok && x.value.exchange.status).toBe("approved")
  })

  test("repeat with replace sends targetVersions; publish sends version and overrides", async () => {
    answer = () => json({ created: [weekDto], conflicts: [], counts: { copied: 1, kept: 1, warned: 0, opened: 0 } })
    await actions.repeatWeek(WEEK_ID, { version: 3, weeks: 2, replace: true, targetVersions: { "2026-11-09": 2 } })
    expect(seen[0]!.body).toEqual({ version: 3, weeks: 2, replace: true, targetVersions: { "2026-11-09": 2 } })
    answer = () => json({ week: { ...weekDto, status: "published" }, violations: [] })
    const p = await actions.publishWeek(WEEK_ID, { version: 2, reason: "r", overrideRuleIds: ["daily_rest"] })
    expect(seen[1]!.body).toEqual({ version: 2, reason: "r", overrideRuleIds: ["daily_rest"] })
    expect(p.ok && p.value.week.status).toBe("published")
  })

  test("historyPage reads one page with its cursor and size, after the MFA check; a failure is mapped, never thrown", async () => {
    answer = () => json({ items: [{ id: SHIFT_ID, at: "2026-11-16T09:00:00.000Z", actorId: UID, action: "shift_moved", locationId: LID, weekId: WEEK_ID, shiftId: SHIFT_ID, reason: null, before: null, after: null }], nextCursor: "c2" })
    const r = await actions.historyPage(WEEK_ID, "c1", 20)
    expect(r.ok && r.value.nextCursor).toBe("c2")
    expect(seen[0]).toMatchObject({ method: "GET", path: `/v1/roster/weeks/${WEEK_ID}/history`, query: "?cursor=c1&limit=20" })
    await actions.historyPage(WEEK_ID, null)
    expect(seen[1]!.query).toBe("")
    answer = () => problem(404, "week_not_found")
    const gone = await actions.historyPage(WEEK_ID, null)
    expect(gone.ok === false && gone.error.state).toBe("not_found")
    mfa.ok = false
    await expect(actions.historyPage(WEEK_ID, null)).rejects.toThrow("NEXT_REDIRECT")
  })

  test("add shifts and rules (If-Match) and leave go through the same mapping", async () => {
    answer = () => json({ shifts: [shiftDto], violations: [] }, 201)
    const a = await actions.addShifts(WEEK_ID, { shifts: [{ date: "2026-11-02", userIds: [UID, null], shiftTypeId: "t" }] })
    expect(a.ok && a.value.shifts[0]!.id).toBe(SHIFT_ID)
    answer = () => json({ severity: { daily_rest: "block" }, avgWeekReferenceWeeks: 17, draftWarnDays: 3 })
    await actions.setRules({ severity: { daily_rest: "block" } }, '"etag-1"')
    expect(seen[1]!.ifMatch).toBe('"etag-1"')
    answer = () => json(leaveDto, 201)
    const l = await actions.createLeave({ from: "2026-12-01", to: "2026-12-05", kind: "annual" })
    expect(l.ok && l.value.status).toBe("requested")
    answer = () => json(locationDto)
    expect((await actions.archiveLocation(LID)).ok).toBe(true)
  })

  test("every write checks the second factor first: a redirect is thrown, not mapped, and nothing reaches the API", async () => {
    mfa.ok = false
    await expect(actions.confirmShift(SHIFT_ID)).rejects.toThrow("NEXT_REDIRECT")
    await expect(actions.deleteShift(SHIFT_ID, { version: 1 })).rejects.toThrow("NEXT_REDIRECT")
    expect(seen).toEqual([])
    expect(readFileSync("app/actions/rosters.ts", "utf8")).toMatch(/requireMfaOk\(\)/)
  })

  test("a refused write returns the mapped state, never throws", async () => {
    answer = () => problem(409, "version_conflict")
    const a = await actions.patchShift(SHIFT_ID, { version: 1, patch: {} })
    expect(a).toMatchObject({ ok: false, error: { state: "conflict", refetch: true, toast: { text: "Changed by someone else.", ref: "req-9" } } })
    answer = () => problem(403, "roster_locked")
    expect(await actions.deleteShift(SHIFT_ID, { version: 1 })).toMatchObject({ ok: false, error: { state: "locked", toast: null } })
    answer = () => problem(422, "reason_required")
    expect(await actions.publishWeek(WEEK_ID, { version: 1 })).toMatchObject({ ok: false, error: { state: "reason_required" } })
    answer = () => problem(422, "rule_blocked", { violations: [violationDto] })
    const b = await actions.publishWeek(WEEK_ID, { version: 1 })
    expect(b.ok === false && b.error.state === "rule_blocked" && b.error.violations).toHaveLength(1)
    answer = () => problem(402, "billing_required")
    expect(await actions.confirmShift(SHIFT_ID)).toMatchObject({ ok: false, error: { state: "billing" } })
    answer = () => problem(403, "module_not_entitled")
    expect(await actions.claimShift(SHIFT_ID)).toMatchObject({ ok: false, error: { state: "not_entitled" } })
  })
})
