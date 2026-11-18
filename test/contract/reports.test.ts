import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { makeApiClient, type ApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError, userMessage } from "@/lib/api/problem"
import { toReport } from "@/features/reports/adapters"
import { loadInbox, loadReport, loadTemplates } from "@/features/reports/api"
import { makeAutosaver, makeReportsClient, makeSubmitter } from "@/features/reports/client"
import { makeExportClient } from "@/features/reports/export"
import { loadShifts } from "@/features/shifts/api"
import { toOccurrences, toShiftState } from "@/features/shifts/adapters"
import { toAttention, toDashboard, toStaff, toTeamTasks, toToday } from "@/features/dashboard/adapters"
import { makeTodayClient } from "@/features/dashboard/client"
import { makeShiftsClient } from "@/features/shifts/client"
import { AttentionOut, DashboardOut, StaffOut, TeamTasksOut, TodayOut } from "../../api/src/modules/read-models/dto"
import { ExportOut, InboxOut, ReportSchema, TemplateOut, VersionsOut } from "../../api/src/modules/shift-reports/dto"
import { OccurrencesOut, ShiftsOut } from "../../api/src/modules/shifts/dto"
import { resetSubscribers } from "../../api/src/core/events"
import { registerFiles } from "../../api/src/modules/files"
import { registerGdpr } from "../../api/src/modules/gdpr"
import { registerNotifications } from "../../api/src/modules/notifications"
import { registerSearchIndexers } from "../../api/src/modules/search"
import { registerTasks } from "../../api/src/modules/tasks"
import { registerShiftReports } from "../../api/src/modules/shift-reports"
import { registerWebhooks } from "../../api/src/modules/webhooks-out"
import { resetDb } from "../../api/test/harness"
import { world, type W, type Who } from "../../api/src/modules/shift-reports/world"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))

const TZ = "Europe/Dublin"

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

/** A browser for one signed-in member: the real app behind a `fetch` that carries that member's cookie, the tenant and Origin (as the BFF does). */
function browser(w: W, who: Who, tz = TZ) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers = new Headers(init?.headers)
    headers.set("cookie", who.cookie)
    headers.set("x-tenant", w.tenant.slug)
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", "http://localhost:3000")
    return w.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
  }
  const api: ApiClient = makeApiClient({ baseUrl: "http://api.test", fetch })
  return { api, reports: makeReportsClient(api, tz, undefined, async () => {}), tz }
}

/** No member of a mapped object may be undefined (a renamed API field must not become a silent hole). */
const noUndefined = (v: unknown, path = "$"): string[] => {
  if (v === undefined) return [path]
  if (Array.isArray(v)) return v.flatMap((x, i) => noUndefined(x, `${path}[${i}]`))
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => noUndefined(x, `${path}.${k}`))
  return []
}

describe("T6.7 contract (real API): shifts, reports, template, exports, dashboard, attention and Today", () => {
  test("shifts, occurrences, reporting, reports (current, list, detail, versions), template, report-exports, dashboard (manager, staff, team-tasks), attention and today parse against the strict schemas and map through the adapters with no undefined", async () => {
    const w = await world()
    const task = await w.task(w.staff, { title: "Check fire exits" })
    const s = browser(w, w.staff)
    const m = browser(w, w.ops)

    // shifts + occurrences (manager sees everyone, staff only their own cut)
    const shiftsDto = ShiftsOut.parse(await m.api.get("/v1/shifts"))
    const teams = (await m.api.get("/v1/teams")).map((t) => ({ id: t.id, name: t.name }))
    const state = toShiftState(shiftsDto, teams)
    expect(noUndefined(state)).toEqual([])
    expect(state.patterns[0]).toMatchObject({ name: "Night", team: "Night team", start: "22:00", end: "06:00" })
    expect(state.reporting.teamDefaults).toEqual({ "Night team": true })
    const occ = OccurrencesOut.parse(await m.api.get("/v1/shifts/occurrences", { query: { from: "2026-10-24", to: "2026-10-24" } }))
    const mapped = toOccurrences(occ, state, TZ)
    expect(mapped.length).toBeGreaterThan(0)
    expect(noUndefined(mapped)).toEqual([])
    const own = toShiftState(ShiftsOut.parse(await s.api.get("/v1/shifts")), teams)
    expect(own.members.map((x) => x.personId)).toEqual([w.staff.userId]) // the API's own cut: nothing is re-scoped on the client
    const week = await loadShifts(s.api, { tz: TZ, today: "2026-10-26T09:00:00", scope: "own", meId: w.staff.userId, people: [] })
    expect(noUndefined(week.state)).toEqual([])

    // current + open + draft + submit through the client wrappers
    const current = await s.api.get("/v1/shift-reports/current")
    expect(current).toHaveProperty("item")
    const opened = await s.reports.open(w.pattern, "2026-10-24")
    expect(noUndefined(opened)).toEqual([])
    ReportSchema.parse(await s.api.get("/v1/shift-reports/{id}", { path: { id: opened.reportId! } }))
    const withRows = { ...opened, summary: "Quiet night.", items: opened.items.map((i) => ({ ...i, status: "done" as const, minutes: 30, note: "Locked up" })) }
    const saved = await s.reports.saveDraft(withRows)
    expect(saved).toMatchObject({ version: 2, summary: "Quiet night.", state: "missing" }) // the fake clock is 16 Nov: the 24 Oct report is long past its due instant
    const submitted = await makeSubmitter(s.reports).submit(saved)
    expect(submitted).toMatchObject({ status: "submitted", version: 3, submissions: 1 })
    expect(noUndefined(submitted)).toEqual([])
    expect(submitted.items[0]).toMatchObject({ taskRef: task.ref, outcome: expect.any(String) })
    const versions = VersionsOut.parse(await s.api.get("/v1/shift-reports/{id}/versions", { path: { id: opened.reportId! } }))
    expect(versions.items).toHaveLength(1)
    expect(await s.reports.versions(submitted)).toEqual([{ v: 1, at: expect.any(String), by: expect.any(String), note: "Submitted" }])

    // inbox (manager): the stored report is there, with the id; the list is the API's, not re-scoped
    InboxOut.parse(await m.api.get("/v1/shift-reports", { query: { from: "2026-10-24", to: "2026-10-24" } }))
    const inbox = await loadInbox(m.api, TZ, { from: "2026-10-24", to: "2026-10-24" }, teams)
    expect(noUndefined(inbox.rows)).toEqual([])
    const mine = inbox.rows.find((r) => r.userId === w.staff.userId)!
    expect(mine).toMatchObject({ reportId: opened.reportId, state: "late", team: "Night team", itemCount: 1 }) // first submitted after the 25 Oct due instant (the clock is 16 Nov)
    const virtual = inbox.rows.find((r) => r.userId === w.staff2.userId)!
    expect(virtual.reportId).toBeNull() // assigned, started, no report yet: a virtual row with a key
    expect(virtual.key).toBe(`${w.staff2.userId}:${w.pattern}:2026-10-24`)
    const detail = await loadReport(m.api, TZ, opened.reportId!)
    expect(detail).not.toBeNull()
    expect(await loadReport(m.api, TZ, "00000000-0000-4000-8000-000000000000")).toBeNull() // unknown: not found, no detail

    // accept by a manager; the owner cannot review their own report
    const accepted = await m.reports.accept(detail!, "Thanks")
    expect(accepted).toMatchObject({ status: "accepted", state: "accepted", reviewedBy: expect.any(String) })
    const own403 = await s.reports.accept(accepted, "me").then(() => null, (e: unknown) => e)
    expect(own403).toBeInstanceOf(ApiError)
    expect(classifyApiError(own403).kind).toBe("forbidden")

    // template
    TemplateOut.parse(await m.api.get("/v1/shift-reports/template"))
    const tpl = await loadTemplates(m.api)
    expect(tpl.departments.map((d) => d.dept)).toContain("Night team")
    expect(noUndefined(tpl)).toEqual([])

    // report-exports: request, queued, the job runs between polls, done
    const polled: string[] = []
    const exporter = makeExportClient(m.api, { wait: async () => void (await w.drain()), hidden: () => false })
    const out = await exporter.run({ format: "csv", from: "2026-10-24", to: "2026-10-24" }, { onStatus: (x) => polled.push(x.status) })
    expect(out.kind).toBe("done")
    expect(polled[0]).toBe("queued")
    expect(polled.at(-1)).toBe("done")
    if (out.kind === "done") ExportOut.parse(await m.api.get("/v1/report-exports/{id}", { path: { id: out.id } }))

    // dashboard (manager), team tasks, attention; staff dashboard; today
    const dash = toDashboard(DashboardOut.parse(await m.api.get("/v1/dashboard")), { tz: TZ })
    expect(noUndefined(dash)).toEqual([])
    const people = [{ id: w.staff.userId, name: "Staff", role: "Employee", initials: "ST", avatar: "av1" as const, dept: "" }]
    const openTask = await w.task(w.staff2, { title: "Still open" }) // the first task was completed by the submit
    const team = toTeamTasks(TeamTasksOut.parse(await m.api.get("/v1/dashboard/team-tasks", { query: { limit: 25 } })), { people, tz: TZ, today: "2026-11-16T09:00:00" })
    expect(noUndefined(team)).toEqual([])
    expect(team.tasks.map((x) => x.ref)).toContain(openTask.ref)
    const att = toAttention(AttentionOut.parse(await m.api.get("/v1/attention", { query: { limit: 25 } })))
    expect(noUndefined(att)).toEqual([])
    const staff = toStaff(StaffOut.parse(await s.api.get("/v1/dashboard/staff")), { tz: TZ })
    expect(noUndefined(staff)).toEqual([])
    const todayDto = TodayOut.parse(await s.api.get("/v1/today", { query: { mode: "all" } }))
    const today = toToday(todayDto, { meId: w.staff.userId, tz: TZ, nowAt: "2026-11-16T09:00:00.000Z", now: "2026-11-16T09:00:00", tzLabel: "Irish time", mode: "card" })
    expect(noUndefined(today)).toEqual([])
    expect(today.day.key).toBe(todayDto.workingDay.key)
  })

  test("submit through the client wrappers: open, draft, submit with a requestId twice gives one version", async () => {
    const w = await world()
    await w.task(w.staff)
    const s = browser(w, w.staff)
    const opened = await s.reports.open(w.pattern, "2026-10-24")
    const draft = await s.reports.saveDraft({ ...opened, summary: "Quiet night.", items: opened.items.map((i) => ({ ...i, status: "done" as const, minutes: 20 })) })
    // the same attempt twice (a retry after a lost answer): the SAME request id, so one version
    let ids = 0
    const submitter = makeSubmitter(s.reports, () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++ids).padStart(12, "0")}`)
    const first = await submitter.submit(draft)
    expect(first.version).toBe(3)
    const second = await s.reports.submit(draft, "aaaaaaaa-aaaa-4aaa-8aaa-000000000001") // the lost-answer retry: same id, the stale version is fine
    expect(second.version).toBe(3)
    expect(second.submissions).toBe(1)
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(1)
    // a DIFFERENT id for the same attempt loses its version: 409 version_conflict (it is never a second submission)
    const other = await s.reports.submit(draft, "bbbbbbbb-bbbb-4bbb-8bbb-000000000002").then(() => null, (e: unknown) => e)
    expect(classifyApiError(other).kind).toBe("version_conflict")
    expect((await w.q("select count(*)::int n from shift_report_versions"))[0].n).toBe(1)
    // a locked report: 409 report_locked with its copy; invalid: 422 report_invalid with field errors
    const locked = await s.reports.saveDraft(first).then(() => null, (e: unknown) => e)
    expect(userMessage(locked).text).toMatch(/locked|changed/i)
    expect(locked).toBeInstanceOf(ApiError)
  })

  test("draft autosave with the version: two tabs, the second gets 409 version_conflict and a reload", async () => {
    const w = await world()
    await w.task(w.staff)
    const a = browser(w, w.staff)
    const b = browser(w, w.staff)
    const opened = await a.reports.open(w.pattern, "2026-10-24")
    let conflict = 0
    const saves: number[] = []
    const auto = makeAutosaver({
      delay: 0, version: opened.version, setTimer: (fn) => (void Promise.resolve().then(fn), 0), clearTimer: () => {},
      save: async (form: typeof opened, v) => (saves.push(v), a.reports.saveDraft({ ...form, version: v })),
      onSaved: () => {}, onConflict: () => void conflict++, onError: () => {},
    })
    await b.reports.saveDraft({ ...opened, summary: "from the other tab" }) // the other tab saves first: version 2
    auto.schedule({ ...opened, summary: "mine" })
    await auto.flush()
    expect(saves).toEqual([1])
    expect(conflict).toBe(1)
    const fresh = await a.reports.get(opened.reportId!)
    expect(fresh).toMatchObject({ summary: "from the other tab", version: 2 })
  })

  test("F5: a team manager sees themself and their DIRECT reports only; an indirect report's report is absent from the inbox and is 'not found' by id (no FE re-scoping)", async () => {
    const w = await world()
    await w.manages(w.manager, w.staff) // staff reports to the manager
    await w.manages(w.staff, w.staff2) // staff2 reports to staff: indirect for the manager
    await w.task(w.staff)
    await w.task(w.staff2)
    const direct = await browser(w, w.staff).reports.open(w.pattern, "2026-10-24")
    const indirect = await browser(w, w.staff2).reports.open(w.pattern, "2026-10-24")
    const m = browser(w, w.manager)
    const teams = (await m.api.get("/v1/teams")).map((t) => ({ id: t.id, name: t.name }))
    const rows = (await loadInbox(m.api, TZ, { from: "2026-10-24", to: "2026-10-24" }, teams)).rows
    expect(rows.map((r) => r.userId).sort()).toEqual([w.staff.userId].sort())
    expect(rows.find((r) => r.reportId === direct.reportId)).toBeDefined()
    expect(JSON.stringify(rows)).not.toContain(w.staff2.userId)
    expect(await loadReport(m.api, TZ, direct.reportId!)).not.toBeNull()
    expect(await loadReport(m.api, TZ, indirect.reportId!)).toBeNull() // 404: no detail about it
    // an all-scope manager sees both
    const all = (await loadInbox(browser(w, w.ops).api, TZ, { from: "2026-10-24", to: "2026-10-24" }, teams)).rows
    expect(all.map((r) => r.userId)).toEqual(expect.arrayContaining([w.staff.userId, w.staff2.userId]))
  })

  test("the DST nights: the 24 Oct 2026 night is 22:00 to 06:00 (nine real hours) and the 27 Mar 2027 night 22:00 to 06:00 (seven), from the stored instants; a team manager is refused pattern edits with the 403 copy", async () => {
    const w = await world({ now: "2027-03-28T12:00:00Z" })
    const m = browser(w, w.ops)
    const teams = (await m.api.get("/v1/teams")).map((t) => ({ id: t.id, name: t.name }))
    const state = toShiftState(await m.api.get("/v1/shifts"), teams)
    const oct = toOccurrences(await m.api.get("/v1/shifts/occurrences", { query: { from: "2026-10-24", to: "2026-10-24", userId: w.staff.userId } }), state, TZ)
    expect(oct).toHaveLength(1)
    expect(oct[0]!.window).toMatchObject({ date: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", endsNextDay: true, minutes: 540 })
    const mar = toOccurrences(await m.api.get("/v1/shifts/occurrences", { query: { from: "2027-03-27", to: "2027-03-27", userId: w.staff.userId } }), state, TZ)
    expect(mar[0]!.window).toMatchObject({ date: "2027-03-27", start: "2027-03-27T22:00", end: "2027-03-28T06:00", minutes: 420 })
    // the report built over the fold keeps the stored instants and is due at 07:00 local (07:00Z in October, 06:00Z in March)
    const s = browser(w, w.staff)
    const rep = await s.reports.open(w.pattern, "2027-03-27")
    expect([rep.start, rep.end, rep.due]).toEqual(["2027-03-27T22:00", "2027-03-28T06:00", "2027-03-28T07:00"])
    expect(rep.dueAt).toBe("2027-03-28T06:00:00.000Z")
    // a team-scope manager may not edit patterns: 403, shown as 'All-scope managers only'
    const mgr = browser(w, w.manager)
    const client = makeShiftsClient(mgr.api, teams)
    const refused = await client.createPattern({ name: "Early", team: "Night team", start: "06:00", end: "14:00", days: [1] }).then(() => null, (e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect(classifyApiError(refused).kind).toBe("forbidden")
    // the all-scope manager does edit, with the version
    const ops = makeShiftsClient(m.api, teams)
    const created = await ops.createPattern({ name: "Early", team: "Night team", start: "06:00", end: "14:00", days: [1] })
    const updated = await ops.updatePattern({ id: created.id, version: created.version, timeZone: undefined }, { name: "Early", team: "Night team", start: "06:00", end: "15:00", days: [1] })
    expect(updated).toMatchObject({ end: "15:00", version: created.version + 1 })
  })

  test("Today: the update takes the working-day key from /v1/today; a stale key is refetched; snooze adds only the history line", async () => {
    const w = await world()
    const task = await w.task(w.staff, { title: "Today task", due: "2026-11-16T15:00:00.000Z", start: "2026-11-16T08:00:00.000Z" })
    const s = browser(w, w.staff)
    const client = makeTodayClient(s.api)
    const dto = TodayOut.parse(await client.load("all"))
    const key = dto.workingDay.key
    expect(await client.update(task.id, "snooze", key)).toEqual({ kind: "snoozed" })
    expect(await client.update(task.id, "snooze", key)).toEqual({ kind: "duplicate" })
    expect(await client.update(task.id, "done", "1999-01-01")).toEqual({ kind: "stale_day" })
    expect((await w.taskRow(task.id)).status).not.toBe("completed")
    expect(await client.update(task.id, "done", key)).toEqual({ kind: "done" })
    expect((await w.taskRow(task.id)).status).toBe("completed")
  })

  test("a support session gets 403 on Today and the staff dashboard; template and exports as a plain member", async () => {
    const w = await world()
    const s = browser(w, w.staff)
    const forbidden = await s.api.put("/v1/shift-reports/template", { body: { departments: [{ dept: "Night team", sections: [] }] } }).then(() => null, (e: unknown) => e)
    expect(classifyApiError(forbidden).kind).toBe("forbidden") // settings:write only
    const o = browser(w, w.owner)
    const t = await o.reports.template()
    t.departments[0]!.sections = [{ id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Shift summary", required: true }] }]
    const saved = await o.reports.saveTemplate(t)
    expect(saved.departments[0]!.sections[0]!.fields[0]).toMatchObject({ id: "summary", required: true })
    // 422 invalid_template maps to field errors
    const bad = await o.reports.saveTemplate({ departments: [{ dept: "A", sections: [] }, { dept: "a", sections: [] }] }).then(() => null, (e: unknown) => e)
    expect(classifyApiError(bad).kind).toBe("unprocessable")
    // report adapter strictness on the real payload: a renamed key must throw
    const opened = await browser(w, w.staff).reports.open(w.pattern, "2026-10-24").catch(() => null)
    if (opened) expect(() => toReport({ ...(ReportSchema.parse(JSON.parse(JSON.stringify(opened))) as object), surprise: 1 }, TZ)).toThrow()
  })
})
