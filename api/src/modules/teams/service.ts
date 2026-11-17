import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { reportScope, type ReportAccess } from "@opsdesk/domain/permissions"
import type { ResolvedRole } from "../../core/context"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { publish } from "../../core/events"
import { memberships, projects, reportingLines, roles, shiftPatterns, taskTemplates, tasks, teamMembers, teams, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { lockActor } from "../rbac"
import { renameTemplateDept, lockSettings } from "../settings"
import { templateReportScope } from "../tenants"

type Actor = { userId: string }
export type TeamKind = "team" | "department"
export type TeamDto = { id: string; name: string; kind: TeamKind; memberIds: string[] }

export const NotAMember = () => new AppError(422, "not_a_member", "Unprocessable Entity")

// Two-key advisory lock namespace for team / reporting-line mutations ("team"). Same pattern as the RBAC lock: one writer
// per tenant, taken FIRST (before lockActor and any row lock), released at commit/rollback. This is what stops two
// concurrent manager changes that only form a cycle TOGETHER from both passing the cycle check.
const TEAM_LOCK_NS = 0x7465616d

async function lockTeams(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${TEAM_LOCK_NS}::int, hashtext(${tenantId}::text))`)
}

/** Lock, then re-check settings:write on the actor INSIDE the tx (R25). */
async function begin(tx: TenantTx, tenantId: string, actor: Actor): Promise<void> {
  await lockTeams(tx, tenantId)
  await lockActor(tx, tenantId, actor.userId, "settings", "write")
}

async function memberIdsOf(tx: TenantTx, tenantId: string, teamId: string): Promise<string[]> {
  const rows = await tx.select({ u: teamMembers.userId }).from(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.teamId, teamId))).orderBy(asc(teamMembers.userId))
  return rows.map((r) => r.u)
}

async function teamIn(tx: TenantTx, tenantId: string, id: string): Promise<typeof teams.$inferSelect> {
  const [t] = await tx.select().from(teams).where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))) // RLS + explicit filter
  if (!t) throw NotFound("team_not_found")
  return t
}

const dto = (t: { id: string; name: string; kind: string }, memberIds: string[]): TeamDto => ({ id: t.id, name: t.name, kind: t.kind as TeamKind, memberIds })

export async function listTeams(tx: TenantTx, tenantId: string, f: { member?: string; kind?: TeamKind }): Promise<TeamDto[]> {
  const conds = [eq(teams.tenantId, tenantId)]
  if (f.kind) conds.push(eq(teams.kind, f.kind))
  if (f.member) conds.push(sql`exists (select 1 from ${teamMembers} tm where tm.team_id = ${teams.id} and tm.user_id = ${f.member})`)
  const rows = await tx.select().from(teams).where(and(...conds)).orderBy(asc(teams.name))
  if (rows.length === 0) return []
  const links = await tx.select().from(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.teamId, rows.map((r) => r.id)))).orderBy(asc(teamMembers.userId))
  return rows.map((t) => dto(t, links.filter((l) => l.teamId === t.id).map((l) => l.userId)))
}

async function assertNameFree(tx: TenantTx, tenantId: string, name: string, exceptId?: string): Promise<void> {
  const [clash] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, tenantId), eq(teams.name, name)))
  if (clash && clash.id !== exceptId) throw Conflict("team_name_taken")
}

export async function createTeam(tx: TenantTx, tenantId: string, actor: Actor, input: { name: string; kind: TeamKind }, now: Date): Promise<TeamDto> {
  await begin(tx, tenantId, actor)
  await assertNameFree(tx, tenantId, input.name)
  const [row] = await tx.insert(teams).values({ tenantId, name: input.name, kind: input.kind }).returning()
  await recordAudit(tx, tenantId, { action: "team.created", entity: "team", entityId: row.id, actorId: actor.userId, before: null, after: { name: row.name, kind: row.kind } }, now)
  await publish(tx, { tenantId, type: "team.created", payload: { teamId: row.id, name: row.name, kind: row.kind }, actorId: actor.userId }, now)
  return dto(row, [])
}

export async function updateTeam(tx: TenantTx, tenantId: string, actor: Actor, id: string, patch: { name?: string; kind?: TeamKind }, now: Date): Promise<TeamDto> {
  await lockTeams(tx, tenantId)
  // A rename may rewrite the report template (ruling I26), so the settings lock is taken here, BEFORE the actor lock, in the same order as every settings writer (team lock, settings lock, actor, rows).
  if (patch.name !== undefined) await lockSettings(tx, tenantId)
  await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const cur = await teamIn(tx, tenantId, id)
  if (patch.name !== undefined) await assertNameFree(tx, tenantId, patch.name, id)
  // The report template is keyed by team NAME: carry the matching department to the new name in this transaction, so a rename cannot silently change which template applies.
  const templateRenamed = patch.name !== undefined && patch.name !== cur.name ? await renameTemplateDept(tx, tenantId, cur.name, patch.name) : false
  const [row] = await tx.update(teams).set({ ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.kind !== undefined ? { kind: patch.kind } : {}) }).where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))).returning()
  await recordAudit(tx, tenantId, { action: "team.updated", entity: "team", entityId: id, actorId: actor.userId, before: { name: cur.name, kind: cur.kind }, after: { name: row.name, kind: row.kind, reportTemplateRenamed: templateRenamed } }, now)
  await publish(tx, { tenantId, type: "team.updated", payload: { teamId: id, name: row.name, kind: row.kind }, actorId: actor.userId }, now)
  return dto(row, await memberIdsOf(tx, tenantId, id))
}

export async function deleteTeam(tx: TenantTx, tenantId: string, actor: Actor, id: string, now: Date): Promise<void> {
  await begin(tx, tenantId, actor)
  const cur = await teamIn(tx, tenantId, id)
  // A team that still has a shift pattern (archived ones too: reports keep pointing at them) cannot be deleted (T5.1): the composite FK has no cascade.
  const [pattern] = await tx.select({ id: shiftPatterns.id }).from(shiftPatterns).where(and(eq(shiftPatterns.tenantId, tenantId), eq(shiftPatterns.teamId, id))).limit(1)
  if (pattern) throw Conflict("team_has_shifts")
  const memberIds = await memberIdsOf(tx, tenantId, id)
  await tx.update(tasks).set({ teamId: null }).where(and(eq(tasks.tenantId, tenantId), eq(tasks.teamId, id))) // tasks keep existing without a department (composite FK has no SET NULL on one column)
  await tx.update(projects).set({ teamId: null }).where(and(eq(projects.tenantId, tenantId), eq(projects.teamId, id))) // projects_team_fk has no SET NULL either
  await tx.update(taskTemplates).set({ teamId: null }).where(and(eq(taskTemplates.tenantId, tenantId), eq(taskTemplates.teamId, id))) // task_templates_team_fk likewise
  try {
    await tx.delete(teams).where(and(eq(teams.id, id), eq(teams.tenantId, tenantId))) // team_members rows cascade
  } catch (err) {
    // a pattern created between the check above and here (FK 23503 on shift_patterns_team_fk, read from .cause, R9); the tx is aborted either way, so this only picks the status
    if ((err as { cause?: { code?: string; constraint?: string } })?.cause?.code === "23503" && (err as { cause?: { constraint?: string } }).cause?.constraint === "shift_patterns_team_fk") throw Conflict("team_has_shifts")
    throw err
  }
  await recordAudit(tx, tenantId, { action: "team.deleted", entity: "team", entityId: id, actorId: actor.userId, before: { name: cur.name, kind: cur.kind, userIds: memberIds }, after: null }, now)
  await publish(tx, { tenantId, type: "team.deleted", payload: { teamId: id }, actorId: actor.userId }, now)
}

/** Replaces the whole member set of a team. Every id must be a member of THIS tenant, else 422 not_a_member. */
export async function setTeamMembers(tx: TenantTx, tenantId: string, actor: Actor, id: string, userIds: string[], now: Date): Promise<TeamDto> {
  await begin(tx, tenantId, actor)
  const cur = await teamIn(tx, tenantId, id)
  const next = [...new Set(userIds)].sort()
  if (next.length > 0) {
    const found = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, next)))
    if (found.length !== next.length) throw NotAMember()
  }
  const before = await memberIdsOf(tx, tenantId, id)
  await tx.delete(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.teamId, id)))
  if (next.length > 0) await tx.insert(teamMembers).values(next.map((userId) => ({ tenantId, teamId: id, userId })))
  await recordAudit(tx, tenantId, { action: "team.members_set", entity: "team", entityId: id, actorId: actor.userId, before: { userIds: before }, after: { userIds: next } }, now)
  return dto(cur, next)
}

/** True when `userId` is `from` itself or one of its (transitive) managers, i.e. making `userId` report to `from` would close a loop. */
async function wouldCycle(tx: TenantTx, tenantId: string, userId: string, proposedManager: string): Promise<boolean> {
  // Walk manager_id upward from the proposed manager. UNION (not ALL) de-duplicates, so the walk terminates even on bad data.
  const res = await tx.execute(sql`
    with recursive up(id) as (
      select ${proposedManager}::text
      union
      select rl.manager_id from reporting_lines rl join up on rl.user_id = up.id where rl.tenant_id = ${tenantId}::uuid
    )
    select 1 as hit from up where id = ${userId}::text limit 1`)
  return res.rows.length > 0
}

/** Sets (or, with null, clears) the single primary manager of `userId`. Path user not a member: 404. Body manager not a member: 422. */
export async function setManager(tx: TenantTx, tenantId: string, actor: Actor, userId: string, managerId: string | null, now: Date): Promise<{ userId: string; managerId: string | null }> {
  await begin(tx, tenantId, actor)
  const [target] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  if (!target) throw NotFound("member_not_found")
  if (managerId !== null) {
    if (managerId === userId) throw new AppError(422, "self_manager", "Unprocessable Entity")
    const [mgr] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, managerId)))
    if (!mgr) throw NotAMember()
    if (await wouldCycle(tx, tenantId, userId, managerId)) throw Conflict("reporting_cycle")
  }
  const [prev] = await tx.select({ m: reportingLines.managerId }).from(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.userId, userId)))
  if (managerId === null) await tx.delete(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.userId, userId)))
  else await tx.insert(reportingLines).values({ tenantId, userId, managerId }).onConflictDoUpdate({ target: [reportingLines.tenantId, reportingLines.userId], set: { managerId } })
  await recordAudit(tx, tenantId, { action: "member.manager_set", entity: "member", entityId: userId, actorId: actor.userId, before: { managerId: prev?.m ?? null }, after: { managerId } }, now)
  return { userId, managerId }
}

/** User ids that report directly to `managerId` (tenant comes from the tx via RLS). */
export async function directReports(tx: TenantTx, managerId: string): Promise<string[]> {
  const rows = await tx.select({ u: reportingLines.userId }).from(reportingLines).where(eq(reportingLines.managerId, managerId)).orderBy(asc(reportingLines.userId))
  return rows.map((r) => r.u)
}

/** The ACTIVE primary manager of `userId` (reporting_lines), or null: no manager, or the manager is suspended or gone (the caller falls back, e.g. to the owners). */
export async function activePrimaryManager(tx: TenantTx, tenantId: string, userId: string): Promise<string | null> {
  const [r] = await tx
    .select({ m: reportingLines.managerId })
    .from(reportingLines)
    .innerJoin(memberships, and(eq(memberships.tenantId, reportingLines.tenantId), eq(memberships.userId, reportingLines.managerId), eq(memberships.status, "active")))
    .where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.userId, userId)))
  return r?.m ?? null
}

// ---- people ----
export type Scope = "own" | "team" | "all"
const RANK: Record<Scope, number> = { own: 0, team: 1, all: 2 }

/**
 * The role's report scope (reportScope in @opsdesk/domain). The DB role carries neither `person` nor `reportScope`, so: person is
 * the caller (a user id is the person here) and "team" is inherited from the role TEMPLATE in roles.json, following cloned_from
 * so a clone of `manager` keeps its team ceiling instead of widening to "all".
 */
export async function peopleAccess(tx: TenantTx, tenantId: string, role: ResolvedRole, meId: string): Promise<ReportAccess | null> {
  return reportScope({ ...role, person: meId, reportScope: await effectiveReportScope(tx, tenantId, role) }, meId)
}

/** The role template's `reportScope` ("team"), following `cloned_from` (up to 5 levels) so a clone of `manager` keeps its team ceiling. Shared by people and tasks. */
export async function effectiveReportScope(tx: TenantTx, tenantId: string, role: ResolvedRole): Promise<"team" | undefined> {
  let key = role.key
  let id: string | null = role.id
  for (let i = 0; i < 5 && id; i++) {
    if (templateReportScope(key)) break
    const [r] = await tx.select({ cloned: roles.clonedFrom }).from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)))
    if (!r?.cloned) break
    const [src] = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(and(eq(roles.id, r.cloned), eq(roles.tenantId, tenantId)))
    if (!src) break
    id = src.id
    key = src.key
  }
  return templateReportScope(key)
}

/** The widest scope the role may request, or null when it has no reports access. `requested` above that ceiling returns "forbidden". */
export function resolveScope(access: ReportAccess | null, requested: Scope | undefined): Scope | "forbidden" {
  if (!access) return "forbidden"
  const ceiling: Scope = access.kind
  const want = requested ?? ceiling
  return RANK[want] <= RANK[ceiling] ? want : "forbidden"
}

export type PersonDto = { userId: string; name: string; email: string; roleKey: string; managerId: string | null }

export async function listPeople(tx: TenantTx, tenantId: string, scope: Scope, meId: string): Promise<PersonDto[]> {
  const conds = [eq(memberships.tenantId, tenantId), eq(memberships.status, "active")]
  if (scope === "own") conds.push(eq(memberships.userId, meId))
  if (scope === "team") conds.push(eq(reportingLines.managerId, meId))
  const rows = await tx
    .select({ userId: memberships.userId, name: user.name, email: user.email, roleKey: roles.key, managerId: reportingLines.managerId })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(reportingLines, and(eq(reportingLines.tenantId, memberships.tenantId), eq(reportingLines.userId, memberships.userId)))
    .where(and(...conds))
    .orderBy(asc(user.name), asc(memberships.userId))
  return rows
}
