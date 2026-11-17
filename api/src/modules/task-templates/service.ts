import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { can } from "@opsdesk/domain/permissions"
import type { EvidenceRule } from "@opsdesk/domain/task-evidence"
import { diffFields } from "@opsdesk/domain/task-history"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { taskTemplates, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { checkAssignees, checkRule, checkTeam, normaliseLabels, type TaskCtx } from "../tasks"
import type { TemplateCreateInput, TemplateDto, TemplatePatchInput } from "./dto"

// Task templates (FR-TASK-10). A template is a tenant-wide blueprint: anyone with tasks:read lists them, only managers (manager-home with
// tasks:write) write them. The server applies ONLY the template's evidence rule on POST /v1/tasks (ruling D23); the other fields are filled
// in by the client (applyTemplate). A template never carries a voice note (ruling D21): there is no such column. History is not kept for
// templates; only a DELETE is audited (ruling D7).

const TemplateNotFound = () => NotFound("template_not_found")
type Row = typeof taskTemplates.$inferSelect

const requireManager = (ctx: TaskCtx) => {
  if (ctx.role.home !== "manager" || !can(ctx.role, "tasks", "write")) throw Forbidden("forbidden")
}

const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name, id]), "utf8").toString("base64url")
function decodeCursor(c: string): { name: string; id: string } {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as unknown
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" && /^[0-9a-f-]{36}$/i.test(v[1])) return { name: v[0], id: v[1] }
  } catch {
    /* falls through */
  }
  throw new AppError(400, "invalid_cursor", "Bad Request")
}

async function dtos(tx: TenantTx, ctx: TaskCtx, rows: Row[]): Promise<TemplateDto[]> {
  const teamIds = [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))]
  const teamRows = teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, teamIds))) : []
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  const free = (v: string) => (ctx.drive ? v : withholdDriveText(v))
  return rows.map((r) => ({
    id: r.id, name: free(r.name), title: free(r.title), description: free(r.description), dept: r.teamId ? (teamName.get(r.teamId) ?? "") : "", teamId: r.teamId,
    ...(r.assigneeId ? { assignee: r.assigneeId } : {}), priority: r.priority, tags: r.labels, evidenceRule: r.evidenceRule, dueOffset: r.dueOffsetDays, dueTime: r.dueTime,
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), version: r.version,
  }))
}

/** The list statement (name order, cursor on (name, id)); exported so the EXPLAIN test can plan the exact query (task_templates_list_idx). */
export function buildTemplatesQuery(tx: TenantTx, tenantId: string, take: number, after?: { name: string; id: string }) {
  const cursor = after ? sql`(${taskTemplates.name}, ${taskTemplates.id}) > (${after.name}, ${after.id}::uuid)` : undefined
  return tx.select().from(taskTemplates).where(and(eq(taskTemplates.tenantId, tenantId), cursor)).orderBy(asc(taskTemplates.name), asc(taskTemplates.id)).limit(take)
}

export async function listTemplates(tx: TenantTx, ctx: TaskCtx, q: { limit: number; cursor?: string }): Promise<{ items: TemplateDto[]; nextCursor: string | null }> {
  const rows = await buildTemplatesQuery(tx, ctx.tenantId, q.limit + 1, q.cursor ? decodeCursor(q.cursor) : undefined)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  return { items: await dtos(tx, ctx, page), nextCursor: rows.length > q.limit && last ? encodeCursor(last.name, last.id) : null }
}

async function lockedTemplate(tx: TenantTx, ctx: TaskCtx, id: string): Promise<Row> {
  const [row] = await tx.select().from(taskTemplates).where(and(eq(taskTemplates.tenantId, ctx.tenantId), eq(taskTemplates.id, id))).for("update")
  if (!row) throw TemplateNotFound() // unknown id and another tenant's id look alike
  return row
}

/** A template's person: a team-scope manager may name only themself or a direct report (ruling E2); all must be active members. */
const checkPerson = async (tx: TenantTx, ctx: TaskCtx, id: string | null | undefined): Promise<string | null> => {
  if (!id) return null
  await checkAssignees(tx, ctx, id, [])
  return id
}

export async function createTemplate(tx: TenantTx, ctx: TaskCtx, input: TemplateCreateInput): Promise<TemplateDto> {
  requireManager(ctx)
  const teamId = await checkTeam(tx, ctx, input.teamId)
  const assigneeId = await checkPerson(tx, ctx, input.assignee)
  const labels = normaliseLabels(input.tags)
  const evidenceRule = await checkRule(tx, ctx, input.evidenceRule as EvidenceRule | undefined)
  const [row] = await tx
    .insert(taskTemplates)
    .values({
      tenantId: ctx.tenantId, name: input.name, title: input.title, description: input.description, teamId, assigneeId, priority: input.priority, labels, evidenceRule,
      dueOffsetDays: input.dueOffset, dueTime: input.dueTime, createdBy: ctx.me, createdAt: ctx.now,
    })
    .returning()
  return (await dtos(tx, ctx, [row]))[0]
}

export async function patchTemplate(tx: TenantTx, ctx: TaskCtx, id: string, input: TemplatePatchInput): Promise<TemplateDto> {
  requireManager(ctx)
  const row = await lockedTemplate(tx, ctx, id)
  if (row.version !== input.version) throw Conflict("version_conflict")
  const teamId = input.teamId === undefined ? row.teamId : await checkTeam(tx, ctx, input.teamId)
  const assigneeId = input.assignee === undefined ? row.assigneeId : await checkPerson(tx, ctx, input.assignee)
  const labels = input.tags ? normaliseLabels(input.tags) : row.labels
  const evidenceRule = input.evidenceRule ? await checkRule(tx, ctx, input.evidenceRule as EvidenceRule) : row.evidenceRule
  const next = {
    name: input.name ?? row.name, title: input.title ?? row.title, description: input.description ?? row.description, teamId, assigneeId, priority: input.priority ?? row.priority,
    labels, evidenceRule, dueOffsetDays: input.dueOffset ?? row.dueOffsetDays, dueTime: input.dueTime ?? row.dueTime,
  }
  if (diffFields(row, next).length === 0) return (await dtos(tx, ctx, [row]))[0] // nothing changed: no new version
  const [out] = await tx.update(taskTemplates).set({ ...next, version: row.version + 1 }).where(and(eq(taskTemplates.tenantId, ctx.tenantId), eq(taskTemplates.id, id))).returning()
  return (await dtos(tx, ctx, [out]))[0]
}

/** Deleting a template is audited (ruling D7). Tasks made from it are untouched (they never referenced it). */
export async function deleteTemplate(tx: TenantTx, ctx: TaskCtx, id: string): Promise<void> {
  requireManager(ctx)
  const row = await lockedTemplate(tx, ctx, id)
  await tx.delete(taskTemplates).where(and(eq(taskTemplates.tenantId, ctx.tenantId), eq(taskTemplates.id, id)))
  await recordAudit(tx, ctx.tenantId, { action: "task_template.deleted", entity: "task_template", entityId: row.id, actorId: ctx.actorId, before: { name: row.name, title: row.title, version: row.version }, after: null }, ctx.now)
}
