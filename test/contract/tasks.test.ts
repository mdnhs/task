import { bootApi, resetDb } from "./harness"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { makeApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError, userMessage } from "@/lib/api/problem"
import { toPatch, toTask } from "@/features/tasks/adapters"
import { loadArchive, loadBoard, loadCalendar, loadProjects, loadTaskByRef, loadTaskPage, loadTemplates } from "@/features/tasks/api"
import { makeCatalogClient, makeTasksClient } from "@/features/tasks/client"
import { rangeOf } from "@/features/tasks/calendar"
import { canVerifyTask } from "@/features/tasks/evidence-view"
import { ArchiveListSchema, BoardSchema, CalendarSchema } from "../../api/src/modules/tasks/views"
import { HistoryList, TaskDtoSchema, TaskList } from "../../api/src/modules/tasks/dto"
import { CommentList } from "../../api/src/modules/tasks/collab"
import { ProjectList } from "../../api/src/modules/projects/dto"
import { TemplateList } from "../../api/src/modules/task-templates/dto"
import { ownerQuery, ownerTenantQuery } from "../../api/test/db"
import { makeMember, makeTenant, signIn } from "../../api/test/factories"

vi_mock_server_only()
function vi_mock_server_only() {} // (api.ts imports lib/api/server only for taskScreenData; the loaders used here take a client)

vi.mock("server-only", () => ({})) // features/tasks/api.ts imports lib/api/server for taskScreenData; the loaders used here take a client
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))

beforeEach(resetDb)

type Booted = ReturnType<typeof bootApi>
async function browser(t: Booted, who: { email: string; password: string }, slug: string) {
  const { cookie } = await signIn(t.app, who.email, who.password)
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers = new Headers(init?.headers)
    headers.set("cookie", cookie)
    headers.set("x-tenant", slug)
    if ((init?.method ?? "GET") !== "GET") headers.set("origin", t.origin)
    return t.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
  }
  const api = makeApiClient({ baseUrl: "http://api.test", fetch })
  return { api, tasks: makeTasksClient(api), catalog: makeCatalogClient(api) }
}

async function world() {
  const t = bootApi()
  const tenant = await makeTenant(t.deps, { slug: "coppers", name: "Coppers" })
  await ownerQuery("update tenants set timezone = $1 where id = $2", ["Europe/Dublin", tenant.id])
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const ops = await makeMember(t.deps, tenant.id, "ops")
  const staff = await makeMember(t.deps, tenant.id, "employee")
  const other = await makeMember(t.deps, tenant.id, "employee")
  return { t, tenant, owner, ops, staff, other }
}

/** No member of a mapped object may be undefined (a renamed API field must not become a silent hole). */
const noUndefined = (v: unknown, path = "$"): string[] => {
  if (v === undefined) return [path]
  if (Array.isArray(v)) return v.flatMap((x, i) => noUndefined(x, `${path}[${i}]`))
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => noUndefined(x, `${path}.${k}`))
  return []
}
const form = (assignee: string, over: Record<string, unknown> = {}) => ({
  title: "Check fire exits", description: "Walk every floor.", teamId: null, assignee, others: [], priority: 2 as const, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", tags: ["safety"], ...over,
})

describe("T6.6 contract (real API): tasks", () => {
  test("tasks list, detail by ref, board, calendar, archive, projects, templates, history, comments and evidence parse against the schemas and map through the adapters with no undefined", async () => {
    const { t, owner, staff } = await world()
    const o = await browser(t, owner, "coppers")
    const project = await o.catalog.createProject({ name: "Office move", description: "Move.", due: "2026-12-18" })
    await o.catalog.addMilestone(project.id, { name: "Furniture", due: "2026-12-04" })
    await o.catalog.createTemplate({ name: "Closing", title: "Close up", description: "Lock.", priority: 2, tags: ["x"], dueOffset: 0, dueTime: "17:00" })
    const made = await o.tasks.create(form(staff.userId, { projectId: project.id, evidenceRule: { mode: "required", types: ["note"], min: 1, instruction: "", review: "manager" } }))
    await o.tasks.addChecklistItem(made, "Ground floor")
    await o.tasks.comment(made, "Started", [])
    await o.tasks.addSubtask(made, "Stairwell")
    const archivedMade = await o.tasks.create(form(staff.userId, { title: "Old job" }))
    await o.tasks.archive(archivedMade)

    // list + detail by ref
    const list = TaskList.parse(await o.api.get("/v1/tasks", { query: { limit: 25 } }))
    const page = await loadTaskPage(o.api, { limit: 25 })
    expect(page.tasks.length).toBe(list.items.length)
    for (const x of page.tasks) expect(noUndefined(x)).toEqual([])
    const byRef = await loadTaskByRef(o.api, made.ref)
    expect(byRef).not.toBeNull()
    TaskDtoSchema.parse(await o.api.get("/v1/tasks/{id}", { path: { id: made.id } }))
    expect(noUndefined(byRef!)).toEqual([])
    expect(byRef).toMatchObject({ id: made.id, ref: made.ref, version: expect.any(Number), assignee: staff.userId, checklist: [{ text: "Ground floor", done: false }], notes: [{ text: "Started" }] })
    expect(byRef!.subtasks).toHaveLength(1)
    expect(typeof byRef!.seriesId === "string" || byRef!.seriesId === undefined).toBe(true)

    // history + comments
    const hist = HistoryList.parse(await o.api.get("/v1/tasks/{id}/history", { path: { id: made.id }, query: { limit: 25 } }))
    expect(hist.items.length).toBeGreaterThan(0)
    expect(byRef!.timeline.length).toBeGreaterThan(0)
    CommentList.parse(await o.api.get("/v1/tasks/{id}/comments", { path: { id: made.id }, query: { limit: 25 } }))

    // board, calendar, archive
    BoardSchema.parse(await o.api.get("/v1/tasks/board", { query: {} }))
    const cols = await loadBoard(o.api)
    for (const c of cols) for (const card of c.tasks) expect(noUndefined(card)).toEqual([])
    expect(cols.reduce((n, c) => n + c.count, 0)).toBeGreaterThan(0)
    const range = rangeOf("2026-11-20", "month")
    CalendarSchema.parse(await o.api.get("/v1/tasks/calendar", { query: range }))
    const cal = await loadCalendar(o.api, range.from, range.to)
    expect(cal.tasks.map((x) => x.id)).toContain(made.id)
    ArchiveListSchema.parse(await o.api.get("/v1/tasks/archive", { query: { limit: 25 } }))
    const arch = await loadArchive(o.api)
    expect(arch.tasks.map((x) => x.id)).toEqual([archivedMade.id])
    expect(noUndefined(arch.tasks[0]!)).toEqual([])

    // projects, templates
    ProjectList.parse(await o.api.get("/v1/projects", { query: { limit: 25 } }))
    const projects = await loadProjects(o.api)
    expect(projects[0]).toMatchObject({ name: "Office move", due: "2026-12-18", milestones: [{ name: "Furniture", state: "open" }] })
    expect(noUndefined(projects)).toEqual([])
    TemplateList.parse(await o.api.get("/v1/task-templates", { query: { limit: 25 } }))
    const tpls = await loadTemplates(o.api)
    expect(tpls[0]).toMatchObject({ name: "Closing", dueTime: "17:00" })
    expect(noUndefined(tpls)).toEqual([])
  })

  test("create, patch (version), status, complete by the assignee, verify by a DIFFERENT manager works through the client wrappers; the stale version gets 409; the assignee's own verify is 403 self_verification", async () => {
    const { t, owner, ops, staff, other } = await world()
    const o = await browser(t, owner, "coppers")
    const s = await browser(t, staff, "coppers")
    const m = await browser(t, ops, "coppers")
    const made = await o.tasks.create(form(staff.userId, { evidenceRule: { mode: "required", types: ["note"], min: 1, instruction: "", review: "manager" } }))
    let task = toTask(made)
    expect(task.version).toBe(1)

    // patch with the CURRENT version, only the changed field
    const patched = toTask(await o.tasks.patch(task, { ...task, title: "Check the fire exits" }))
    expect(patched).toMatchObject({ title: "Check the fire exits", version: 2 })
    // the old version is stale
    const stale = await o.tasks.patch(task, { ...task, title: "Again" }).then(() => null, (e: unknown) => e)
    expect(stale).toBeInstanceOf(ApiError)
    expect(classifyApiError(stale).kind).toBe("version_conflict")
    expect(userMessage(stale).text).toBe("Changed by someone else.")
    task = patched

    // the assignee works it: status, evidence, complete
    task = toTask(await s.tasks.setStatus(task, "in_progress"))
    expect(task.status).toBe("in_progress")
    await s.tasks.addNoteEvidence(task, "Checked every exit")
    const early = await s.tasks.complete({ id: task.id, version: task.version }).then(() => null, (e: unknown) => e)
    expect(early).toBeNull() // a note counts at once: the task goes to review
    task = (await loadTaskByRef(s.api, task.ref))!
    expect(task.status).toBe("submitted")

    // nobody verifies their own work: the assignee is refused (the UI hides the button; the API is the authority)
    expect(canVerifyTask(task, { id: staff.userId, name: "S", manager: false })).toBe(false)
    const own = await s.tasks.verify(task).then(() => null, (e: unknown) => e)
    expect(userMessage(own).text).toBe("You can't verify your own task.")
    // a different manager verifies
    expect(canVerifyTask(task, { id: ops.userId, name: "Ops", manager: true })).toBe(true)
    const done = toTask(await m.tasks.verify(task))
    expect(done.status).toBe("completed")
    // a staff member opens somebody else's task: the server says 404 and the loader turns it into "not found"
    const so = await browser(t, other, "coppers")
    expect(await loadTaskByRef(so.api, task.ref)).toBeNull()
  })

  test("ISO round trip: a task due in the repeated DST hour (the SECOND 01:30 on 25 Oct 2026, Europe/Dublin) is patched with an unchanged date and keeps its dueAt", async () => {
    const { t, owner, staff, tenant } = await world()
    const o = await browser(t, owner, "coppers")
    const made = await o.tasks.create(form(staff.userId, { start: "2026-10-24T09:00:00", due: "2026-10-25T02:30:00" }))
    // the second 01:30 (after the clocks went back) is 01:30Z; its wall string is the same as the FIRST 01:30 (00:30Z)
    await ownerTenantQuery(tenant.id, "update tasks set due_at = '2026-10-25T01:30:00Z' where id = $1", [made.id])
    const task = (await loadTaskByRef(o.api, made.ref))!
    expect(task.dueAt).toBe("2026-10-25T01:30:00.000Z")
    expect(task.due).toBe("2026-10-25T01:30:00")
    const patch = toPatch(task, { ...task, title: "Renamed" })
    expect(patch).not.toHaveProperty("due")
    const after = toTask(await o.tasks.patch(task, { ...task, title: "Renamed" }))
    expect(after.dueAt).toBe("2026-10-25T01:30:00.000Z") // unchanged
    // the wall string the old UI sent back WOULD have moved it an hour earlier: that is why it is never re-sent
    const wrong = toTask(await o.api.patch("/v1/tasks/{id}", { path: { id: task.id! }, body: { version: after.version!, due: task.due } }))
    expect(wrong.dueAt).toBe("2026-10-25T00:30:00.000Z")
  })

  test("N2: dependencies with status and blocks map through toTask; what the staff member may not see is only a count", async () => {
    const { t, owner, staff, other } = await world()
    const o = await browser(t, owner, "coppers")
    const s = await browser(t, staff, "coppers")
    const a = await o.tasks.create(form(staff.userId, { title: "A" }))
    const b = await o.tasks.create(form(staff.userId, { title: "B" }))
    const c = await o.tasks.create(form(other.userId, { title: "C" }))
    await o.tasks.setDependencies(a, [b.id, c.id])
    const mine = (await loadTaskByRef(s.api, a.ref))!
    expect(noUndefined(mine)).toEqual([])
    expect(mine.dependencies).toEqual([{ id: b.id, ref: b.ref, title: "B", status: "not_started" }])
    expect(mine.hiddenDependencies).toBe(1)
    const bb = (await loadTaskByRef(s.api, b.ref))!
    expect(bb.blocks!.map((x) => x.ref)).toEqual([a.ref])
  })
})
