// Server side of tasks (B6 T6.6): every screen reads the API as the signed-in member. Scope is the SERVER's (I14): nothing here re-filters by "my tasks" or a person id. A task
// the caller may not see is a 404 (the page shows "not found"), never a client-side hide. Pure loaders take the client, so they are testable.
import type { ApiClient } from "@/lib/api/client"
import { classifyApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getPeople } from "@/lib/people"
import type { Session } from "@/lib/session"
import { toCard, toProject, toTask, toTemplate } from "./adapters"
import type { Person, Project, Task, TaskStatus, TaskTemplate } from "./types"

type Reader = Pick<ApiClient, "get">

export type TaskQuery = { status?: string; due?: string; priority?: string; assignee?: string; project?: string; repeat?: string; q?: string; cursor?: string; limit?: number; label?: string; evidence?: string }

/** One page of the list. `nextCursor` is the API's; the page keeps no total (a cursor has none). */
export async function loadTaskPage(api: Reader, q: TaskQuery = {}): Promise<{ tasks: Task[]; nextCursor: string | null }> {
  const page = await api.get("/v1/tasks", { query: { ...q, limit: q.limit ?? 25 } as never })
  return { tasks: page.items.map((d) => toTask(d)), nextCursor: page.nextCursor }
}

/** The task for a ref (`TSK-1042`), resolved through `GET /v1/tasks?ref=` then the detail by uuid (I11). Null when the caller has no such task (404 or no hit): out of scope looks the same. */
export async function loadTaskByRef(api: Reader, ref: string): Promise<Task | null> {
  if (!/^(tsk-)?\d{1,9}$/i.test(ref)) return null
  try {
    const hit = await api.get("/v1/tasks", { query: { ref, limit: 1 } })
    const found = hit.items[0]
    if (!found) return null
    const [dto, comments] = await Promise.all([api.get("/v1/tasks/{id}", { path: { id: found.id } }), api.get("/v1/tasks/{id}/comments", { path: { id: found.id }, query: { limit: 100 } })])
    return toTask(dto, { comments: comments.items })
  } catch (e) {
    if (classifyApiError(e).kind === "not_found") return null
    throw e
  }
}

export type BoardFilters = { project?: string; assignee?: string; q?: string }
export type BoardColumn = { status: TaskStatus; count: number; tasks: Task[]; nextCursor: string | null }

export async function loadBoard(api: Reader, f: BoardFilters = {}): Promise<BoardColumn[]> {
  const b = await api.get("/v1/tasks/board", { query: f as never })
  return b.columns.map((c) => ({ status: c.status as TaskStatus, count: c.count, tasks: c.items.map(toCard), nextCursor: c.nextCursor }))
}

export type CalendarData = { tasks: Task[]; truncated: boolean }
/** Cards due in [from, to] (tenant-local days, at most 42). The API cuts the days in the tenant zone; the page does not. */
export async function loadCalendar(api: Reader, from: string, to: string): Promise<CalendarData> {
  const c = await api.get("/v1/tasks/calendar", { query: { from, to } })
  return { tasks: c.days.flatMap((d) => d.tasks.map(toCard)), truncated: c.truncated }
}

export type ArchivedTask = Task & { archiveDaysLeft: number }
/** The archive (managers only: 403 otherwise, which the page turns into the restricted state). */
export async function loadArchive(api: Reader, cursor?: string): Promise<{ tasks: ArchivedTask[]; nextCursor: string | null }> {
  const a = await api.get("/v1/tasks/archive", { query: { limit: 25, ...(cursor ? { cursor } : {}) } })
  return { tasks: a.items.map((d) => ({ ...toCard(d), archiveDaysLeft: d.daysLeft })), nextCursor: a.nextCursor }
}

/** Every project (cursor pages followed, at most 4 pages of 100). */
export async function loadProjects(api: Reader): Promise<Project[]> {
  const out: Project[] = []
  let cursor: string | undefined
  for (let i = 0; i < 4; i++) {
    const p = await api.get("/v1/projects", { query: { limit: 100, ...(cursor ? { cursor } : {}) } })
    out.push(...p.items.map(toProject))
    if (!p.nextCursor) break
    cursor = p.nextCursor
  }
  return out
}

export async function loadTemplates(api: Reader): Promise<(TaskTemplate & { version: number; teamId: string | null })[]> {
  const p = await api.get("/v1/task-templates", { query: { limit: 100 } })
  return p.items.map(toTemplate)
}

/** Department teams (id and name): the form sends the team's uuid, the screens show the name. */
export async function loadDepartmentTeams(api: Reader): Promise<{ id: string; name: string }[]> {
  return (await api.get("/v1/teams", { query: { kind: "department" } })).map((t) => ({ id: t.id, name: t.name }))
}

/** Who the caller is on a task screen: a manager acts as reviewer, staff as assignee. Team-scope managers can assign only themselves and their direct reports (the API says 422 assignee_out_of_scope). */
export function viewerOf(session: Session) {
  const manager = session.role.home === "manager"
  return {
    id: session.user.id,
    name: session.user.name,
    manager,
    /** A manager whose reach is their team: project and milestone deletes are all-scope managers only (403 otherwise). */
    teamScope: manager && session.role.reportScope === "team",
    actor: (manager ? "reviewer" : "assignee") as "assignee" | "reviewer",
    purge: session.role.access.settings === "write",
  }
}

export type TaskScreenData = { api: ApiClient; people: Person[] }
export async function taskScreenData(): Promise<TaskScreenData> {
  const [api, people] = await Promise.all([apiServer(), getPeople()])
  return { api, people }
}

/** Shift patterns for the "Every shift" repeat (GET /v1/shifts). The shifts screens are switched in T6.7: until the data is there (any failure, a plan without shifts, a staff cut with none) the choice is simply not offered. */
export async function loadShiftPatterns(api: Reader): Promise<{ id: string; label: string }[]> {
  try {
    const s = await api.get("/v1/shifts")
    return s.patterns.map((p) => ({ id: p.id, label: `${p.name} · ${p.start}–${p.end}` }))
  } catch {
    return []
  }
}
