import { and, asc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { can } from "@opsdesk/domain/permissions"
import type { EvidenceRule } from "@opsdesk/domain/task-evidence"
import { milestoneStateOf, progressOf, type Progress } from "@opsdesk/domain/task-planning"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { memberships, projectMilestones, projects, taskHistory, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { notify } from "../notifications"
import { assigneesOf, checkRule, checkTeam, decodeCursor, encodeCursor, publishTaskEvent, taskScopeWhere, wallOf, type TaskCtx, type TaskEnv } from "../tasks"
import type { MilestoneDto, MilestonePatchInput, ProjectCreateInput, ProjectDto, ProjectPatchInput } from "./dto"

// Projects and milestones (FR-M1-04).
//
// Visibility: a manager-home role sees every project of the tenant (it creates and plans them); a staff-home role sees a project only when
// it leads it or has a live task in it within its own task scope (ruling D5). A project it cannot see is 404 project_not_found.
// Progress ({done,total,pct}, per project and per milestone) counts the live, non-cancelled tasks IN THE CALLER'S TASK SCOPE only, so a
// team manager or a staff member never learns how many tasks exist beyond what they may open: no counting oracle. An all-scope manager
// therefore sees tenant-wide numbers. Archived tasks never count.
// Delete: a project (or milestone) delete UNLINKS its tasks (project_id/milestone_id null, version bumped, a history line each) and keeps
// them; a project delete also removes its milestones and is audited (ruling D7).
// Lock order: actor lock → project row FOR UPDATE (or FOR SHARE from a task PATCH that links to it) → task rows FOR UPDATE sorted by id.

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const ProjectNotFound = () => NotFound("project_not_found")
const MilestoneNotFound = () => NotFound("milestone_not_found")
const OPEN = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]

export type ProjectRow = typeof projects.$inferSelect
type MilestoneRow = typeof projectMilestones.$inferSelect

/** Creating and changing projects and milestones is a manager's job (ruling D6): manager-home with tasks:write, whatever the scope. */
const requireManager = (ctx: TaskCtx) => {
  if (ctx.role.home !== "manager" || !can(ctx.role, "tasks", "write")) throw Forbidden("forbidden")
}

const visibleWhere = (ctx: TaskCtx): SQL =>
  ctx.role.home === "manager"
    ? sql`true`
    : sql`(${projects.leadId} = ${ctx.me} or exists (select 1 from ${tasks} where ${tasks.tenantId} = ${projects.tenantId} and ${tasks.projectId} = ${projects.id} and ${tasks.archivedAt} is null and ${taskScopeWhere(ctx.scope, ctx.reports)}))`

async function getProject(tx: TenantTx, ctx: TaskCtx, id: string, o: { forUpdate?: boolean } = {}): Promise<ProjectRow> {
  const q = tx.select().from(projects).where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId), visibleWhere(ctx)))
  const [row] = o.forUpdate ? await q.for("update", { of: [projects] }) : await q
  if (!row) throw ProjectNotFound()
  return row
}

// ---------- DTOs ----------

/** Progress of live, non-cancelled tasks in the caller's scope, grouped by project or by milestone: one aggregate query each, no per-row queries. */
async function progressBy(tx: TenantTx, ctx: TaskCtx, col: "project" | "milestone", ids: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>()
  if (ids.length === 0) return out
  const key = col === "project" ? tasks.projectId : tasks.milestoneId
  const rows = await tx
    .select({ id: key, total: sql<number>`(count(*) filter (where ${tasks.status} <> 'cancelled'))::int`, done: sql<number>`(count(*) filter (where ${tasks.status} = 'completed'))::int` })
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), inArray(key, ids), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
    .groupBy(key)
  for (const r of rows) out.set(r.id!, progressOf(r.done, r.total))
  return out
}

const free = (ctx: Pick<TaskCtx, "drive">, v: string) => (ctx.drive ? v : withholdDriveText(v))
const today = (ctx: TaskCtx) => wallOf(ctx.now, ctx.tz).slice(0, 10)

function milestoneDto(ctx: TaskCtx, m: MilestoneRow, pr: Progress | undefined): MilestoneDto {
  const p = pr ?? progressOf(0, 0)
  return { id: m.id, name: free(ctx, m.name), due: m.dueDate, position: m.position, state: milestoneStateOf(m.dueDate, p, today(ctx)), ...p }
}

async function projectDtos(tx: TenantTx, ctx: TaskCtx, rows: ProjectRow[]): Promise<ProjectDto[]> {
  const ids = rows.map((r) => r.id)
  const ms = ids.length ? await tx.select().from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), inArray(projectMilestones.projectId, ids))).orderBy(asc(projectMilestones.position), asc(projectMilestones.id)) : []
  const pp = await progressBy(tx, ctx, "project", ids)
  const mp = await progressBy(tx, ctx, "milestone", ms.map((m) => m.id))
  const teamIds = [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))]
  const teamRows = teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, teamIds))) : []
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  return rows.map((r) => ({
    id: r.id, name: free(ctx, r.name), teamId: r.teamId, dept: r.teamId ? (teamName.get(r.teamId) ?? "") : "", leadId: r.leadId, lead: r.leadId ?? "",
    description: free(ctx, r.description), due: r.dueDate, defaultEvidenceRule: r.defaultEvidenceRule, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    version: r.version, progress: pp.get(r.id) ?? progressOf(0, 0), milestones: ms.filter((m) => m.projectId === r.id).map((m) => milestoneDto(ctx, m, mp.get(m.id))),
  }))
}

// ---------- read ----------

/** The list statement (visibility, newest first, cursor on (created_at, id)); exported so the EXPLAIN test can plan the exact query. */
export function buildProjectsQuery(tx: TenantTx, ctx: TaskCtx, after: { at: Date; id: string } | undefined, take: number) {
  const cursor = after ? or(lt(projects.createdAt, after.at), and(eq(projects.createdAt, after.at), lt(projects.id, after.id))) : undefined
  return tx.select().from(projects).where(and(eq(projects.tenantId, ctx.tenantId), visibleWhere(ctx), cursor)).orderBy(sql`${projects.createdAt} desc nulls last`, sql`${projects.id} desc nulls last`).limit(take)
}

export async function listProjects(tx: TenantTx, ctx: TaskCtx, q: { limit: number; cursor?: string }): Promise<{ items: ProjectDto[]; nextCursor: string | null }> {
  const rows = await buildProjectsQuery(tx, ctx, q.cursor ? decodeCursor(q.cursor) : undefined, q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  return { items: await projectDtos(tx, ctx, page), nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null }
}

export async function getProjectDetail(tx: TenantTx, ctx: TaskCtx, id: string): Promise<ProjectDto> {
  return (await projectDtos(tx, ctx, [await getProject(tx, ctx, id)]))[0]
}

// ---------- validation ----------

async function checkLead(tx: TenantTx, ctx: TaskCtx, leadId: string | null | undefined): Promise<string | null> {
  if (!leadId) return null
  const [m] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), eq(memberships.userId, leadId)))
  if (!m) throw unprocessable("invalid_lead") // another tenant's member, an inactive one and a random id all look alike
  return m.u
}

const ruleOf = async (tx: TenantTx, ctx: TaskCtx, r: unknown): Promise<EvidenceRule | null> => (r ? checkRule(tx, ctx, r as EvidenceRule) : null)

const snapshot = (p: ProjectRow) => ({ name: p.name, teamId: p.teamId, leadId: p.leadId, description: p.description, dueDate: p.dueDate, defaultEvidenceRule: p.defaultEvidenceRule })

// ---------- project writes ----------

export async function createProject(tx: TenantTx, ctx: TaskCtx, input: ProjectCreateInput): Promise<ProjectDto> {
  requireManager(ctx)
  const teamId = await checkTeam(tx, ctx, input.teamId)
  const leadId = await checkLead(tx, ctx, input.leadId)
  const rule = await ruleOf(tx, ctx, input.defaultEvidenceRule)
  const [row] = await tx
    .insert(projects)
    .values({ tenantId: ctx.tenantId, name: input.name, teamId, leadId, description: input.description, dueDate: input.due ?? null, defaultEvidenceRule: rule, createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  const dto = (await projectDtos(tx, ctx, [row]))[0]
  await publishTaskEvent(tx, ctx, { type: "project.created", payload: { projectId: row.id } })
  return dto
}

export async function patchProject(tx: TenantTx, ctx: TaskCtx, id: string, input: ProjectPatchInput): Promise<ProjectDto> {
  requireManager(ctx)
  const row = await getProject(tx, ctx, id, { forUpdate: true })
  if (row.version !== input.version) throw Conflict("version_conflict")
  const next = {
    name: input.name ?? row.name,
    teamId: input.teamId === undefined ? row.teamId : await checkTeam(tx, ctx, input.teamId),
    leadId: input.leadId === undefined ? row.leadId : await checkLead(tx, ctx, input.leadId),
    description: input.description ?? row.description,
    dueDate: input.due === undefined ? row.dueDate : input.due,
    defaultEvidenceRule: input.defaultEvidenceRule === undefined ? row.defaultEvidenceRule : await ruleOf(tx, ctx, input.defaultEvidenceRule),
  }
  if (JSON.stringify(next) === JSON.stringify(snapshot(row))) return (await projectDtos(tx, ctx, [row]))[0] // nothing changed: no new version
  const [updated] = await tx.update(projects).set({ ...next, version: row.version + 1, updatedAt: ctx.now }).where(and(eq(projects.id, row.id), eq(projects.tenantId, ctx.tenantId))).returning()
  const dto = (await projectDtos(tx, ctx, [updated]))[0]
  await publishTaskEvent(tx, ctx, { type: "project.updated", payload: { projectId: row.id } })
  return dto
}

/**
 * Takes the tasks that point at a project or milestone (row locks in id order), clears the link, bumps their version and writes one
 * history line each. The tasks (archived ones included, the foreign key demands it) stay; nothing is deleted.
 */
async function unlinkTasks(tx: TenantTx, ctx: TaskCtx, by: { projectId: string } | { milestoneId: string }, text: string): Promise<number> {
  const where = "projectId" in by ? eq(tasks.projectId, by.projectId) : eq(tasks.milestoneId, by.milestoneId)
  const rows = await tx.select().from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), where)).orderBy(asc(tasks.id)).for("update", { of: [tasks] })
  if (rows.length === 0) return 0
  const set = "projectId" in by ? { projectId: null, milestoneId: null } : { milestoneId: null }
  await tx.update(tasks).set({ ...set, version: sql`${tasks.version} + 1`, updatedAt: ctx.now }).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, rows.map((r) => r.id))))
  await tx.insert(taskHistory).values(
    rows.map((r) => ({
      tenantId: ctx.tenantId, taskId: r.id, at: ctx.now, actorId: ctx.actorId, kind: "updated", text, notified: [] as string[],
      changes: [
        ...("projectId" in by && r.projectId ? [{ field: "projectId", from: r.projectId, to: null }] : []),
        ...(r.milestoneId ? [{ field: "milestoneId", from: r.milestoneId, to: null }] : []),
      ],
    })),
  )
  return rows.length
}

/** DELETE /v1/projects/{id}: unlinks its tasks, deletes its milestones with it, and is audited (ruling D7). */
export async function deleteProject(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string): Promise<void> {
  requireManager(ctx)
  const row = await getProject(tx, ctx, id, { forUpdate: true })
  const ms = await tx.select({ id: projectMilestones.id }).from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), eq(projectMilestones.projectId, row.id)))
  const unlinked = await unlinkTasks(tx, ctx, { projectId: row.id }, `Project "${row.name}" was deleted`)
  await tx.delete(projects).where(and(eq(projects.id, row.id), eq(projects.tenantId, ctx.tenantId))) // milestones go with it (cascade)
  await recordAudit(tx, ctx.tenantId, { action: "project.deleted", entity: "project", entityId: row.id, actorId: ctx.actorId, before: { ...snapshot(row), milestones: ms.length, unlinkedTasks: unlinked }, after: null }, ctx.now)
  await publishTaskEvent(tx, ctx, { type: "project.deleted", payload: { projectId: row.id } })
}

// ---------- milestones ----------

async function getMilestone(tx: TenantTx, ctx: TaskCtx, projectId: string, id: string): Promise<MilestoneRow> {
  const [m] = await tx.select().from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), eq(projectMilestones.projectId, projectId), eq(projectMilestones.id, id)))
  if (!m) throw MilestoneNotFound()
  return m
}

const dtoOf = async (tx: TenantTx, ctx: TaskCtx, m: MilestoneRow): Promise<MilestoneDto> => milestoneDto(ctx, m, (await progressBy(tx, ctx, "milestone", [m.id])).get(m.id))

export async function createMilestone(tx: TenantTx, ctx: TaskCtx, projectId: string, input: { name: string; due: string }): Promise<MilestoneDto> {
  requireManager(ctx)
  await getProject(tx, ctx, projectId, { forUpdate: true }) // serialises the position numbering of this project
  const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${projectMilestones.position}) + 1, 0)::int` }).from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), eq(projectMilestones.projectId, projectId)))
  const [m] = await tx.insert(projectMilestones).values({ tenantId: ctx.tenantId, projectId, name: input.name, dueDate: input.due, position: next }).returning()
  await publishTaskEvent(tx, ctx, { type: "project.updated", payload: { projectId } })
  return dtoOf(tx, ctx, m)
}

/** Moving a milestone's date tells the assignees of its open tasks, old and new date in the notice and a history line on each task (FR-M1-11/12). */
export async function patchMilestone(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, projectId: string, id: string, input: MilestonePatchInput): Promise<MilestoneDto> {
  requireManager(ctx)
  await getProject(tx, ctx, projectId, { forUpdate: true })
  const m = await getMilestone(tx, ctx, projectId, id)
  const [updated] = await tx
    .update(projectMilestones)
    .set({ name: input.name ?? m.name, dueDate: input.due ?? m.dueDate, position: input.position ?? m.position })
    .where(and(eq(projectMilestones.id, m.id), eq(projectMilestones.tenantId, ctx.tenantId)))
    .returning()
  if (input.due && input.due !== m.dueDate) {
    const linked = await tx.select({ id: tasks.id, refNo: tasks.refNo, title: tasks.title }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.milestoneId, m.id), sql`${tasks.archivedAt} is null`, inArray(tasks.status, OPEN))).orderBy(asc(tasks.id))
    const people = await assigneesOf(tx, ctx.tenantId, linked.map((t) => t.id))
    for (const t of linked) {
      const p = people.get(t.id)!
      const recipients = [...new Set([...(p.primary ? [p.primary] : []), ...p.others])].filter((u) => u !== ctx.me && u !== ctx.actorId).sort()
      const text = `Milestone "${m.name}" due date changed ${m.dueDate} to ${updated.dueDate}`
      await tx.insert(taskHistory).values({ tenantId: ctx.tenantId, taskId: t.id, at: ctx.now, actorId: ctx.actorId, kind: "milestone", text, changes: [], notified: recipients })
      for (const userId of recipients) await notify(tx, ctx.tenantId, { userId, kind: "task", title: "Milestone date changed", body: `TSK-${t.refNo} ${t.title}: ${m.name} ${m.dueDate} to ${updated.dueDate}`, link: `/tasks/TSK-${t.refNo}` }, env.deps, env.enqueue)
    }
  }
  await publishTaskEvent(tx, ctx, { type: "project.updated", payload: { projectId } })
  return dtoOf(tx, ctx, updated)
}

export async function deleteMilestone(tx: TenantTx, ctx: TaskCtx, projectId: string, id: string): Promise<void> {
  requireManager(ctx)
  await getProject(tx, ctx, projectId, { forUpdate: true })
  const m = await getMilestone(tx, ctx, projectId, id)
  await unlinkTasks(tx, ctx, { milestoneId: m.id }, `Milestone "${m.name}" was deleted`)
  await tx.delete(projectMilestones).where(and(eq(projectMilestones.id, m.id), eq(projectMilestones.tenantId, ctx.tenantId)))
  await publishTaskEvent(tx, ctx, { type: "project.updated", payload: { projectId } })
}
