import { and, eq, sql } from "drizzle-orm"
import type { TaskScope } from "@opsdesk/domain/task-scope"
import type { Db, Deps } from "../../deps"
import { memberships, notifications, plans, publicHolidays, roles, tenants, tenantSettings } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { publish } from "../../core/events"
import { recordAudit } from "../../modules/audit/record"
import { registerDevice, setPolicy } from "../../modules/devices/service"
import { changeSubscriptionTx, invalidateEntitlements } from "../../modules/entitlements/service"
import { createMilestone, createProject } from "../../modules/projects/service"
import { lockActor } from "../../modules/rbac/service"
import { createAssignment, createPattern, setPersonReporting, setTeamReporting } from "../../modules/shifts/service"
import type { ShiftCtx } from "../../modules/shifts/scope"
import { createTemplate } from "../../modules/task-templates/service"
import { createTenant } from "../../modules/tenants/service"
import { createTeam, setManager, setTeamMembers } from "../../modules/teams/service"
import type { TaskCtx } from "../../modules/tasks/scope"
import { validateTemplate } from "../../modules/shift-reports/template"
import { isColor, isDeadline } from "../../modules/settings/service"
import type { Anchor } from "./anchor"
import { detId } from "./ids"
import type { Person } from "./people"
import { seedReports } from "./reports"
import type { MockSubscription, MockTenant, Source } from "./source"
import { seedTasks } from "./tasks"
import { wipeTenantData } from "./wipe"

export type TenantRun = {
  src: Source
  anchor: Anchor
  now: Date
  tz: string
  people: Person[]
  byMock: Map<string, Person>
  byName: Map<string, Person>
  userIds: Map<string, string>
  ownerId: string
  mock: MockTenant
  sub: MockSubscription
  /** The full dataset (people, shifts, tasks, reports) goes to this tenant only; the others hold their owner. */
  full: boolean
  owner?: Db
}

export type TenantCounts = Record<string, number>

/**
 * One tenant: created through createTenant (roles, owner, trial subscription, audit, event) or found by slug, then everything in ONE transaction under the
 * tenant's RLS context. The services are called with the demo owner as the actor, so each write is audited and published exactly as it would be through the
 * API; the rows no service can express (historic tasks, reports, notifications) are raw inserts that keep the same invariants.
 */
export async function seedTenant(db: Db, deps: Deps, run: TenantRun): Promise<{ tenantId: string; counts: TenantCounts; warnings: string[] }> {
  const { src, mock } = run
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, mock.slug))
  let tenantId = existing?.id
  if (!tenantId) tenantId = (await createTenant(deps, run.ownerId, { name: mock.name, slug: mock.slug, timezone: src.org.timezone, currency: src.org.currency, locale: src.org.locale })).id
  else if (run.full) {
    if (!run.owner) throw new Error("owner connection required to re-seed")
    await wipeTenantData(run.owner, tenantId)
  }
  const id = tenantId
  const out = await withTenant(db, id, (tx) => seedInTx(tx, run, id))
  invalidateEntitlements(id)
  return { tenantId: id, ...out }
}

async function seedInTx(tx: TenantTx, run: TenantRun, tenantId: string): Promise<{ counts: TenantCounts; warnings: string[] }> {
  const { src, anchor, now, mock, ownerId } = run
  const warnings: string[] = []
  const counts: TenantCounts = {}
  const actor = { userId: ownerId }

  // ---- organisation, settings, branding, holidays (the tenant's own values; code knows none of them) ----
  if (!isDeadline(src.org.deadline) || !isColor(mock.brand)) throw new Error("bad mock settings")
  await tx.update(tenants).set({ name: mock.name, timezone: src.org.timezone, currency: src.org.currency, locale: src.org.locale, status: "active" }).where(eq(tenants.id, tenantId))
  const setting = (key: string, value: unknown) => tx.insert(tenantSettings).values({ tenantId, key, value }).onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value } })
  await setting("report_deadline", src.org.deadline)
  await setting("report_due_after_minutes", src.reporting.reportDueAfterMinutes)
  await setting("branding", { logoFileId: null, primaryColor: mock.brand })
  if (run.full) {
    const template = { departments: src.reportTemplate.map((d) => ({ dept: d.dept, sections: d.sections })) }
    validateTemplate(template as never)
    await setting("report_template", template)
  }
  if (src.holidays.length) await tx.insert(publicHolidays).values(src.holidays.map((h) => ({ tenantId, date: h.date, name: h.name }))).onConflictDoNothing()
  counts.holidays = src.holidays.length

  // ---- subscription (the plan and the dates are the mock's, moved to the anchor; no provider, no Stripe ids) ----
  const [plan] = await tx.select({ limits: plans.limits }).from(plans).where(eq(plans.id, run.sub.planId))
  if (!plan) throw new Error("unknown plan in the mock")
  const trialing = run.sub.status === "trial"
  await changeSubscriptionTx(
    tx, tenantId, ownerId,
    {
      planId: run.sub.planId, status: trialing ? "trialing" : (run.sub.status as "active" | "past_due"), seats: plan.limits.activeUsers ?? 0,
      trialEndsAt: trialing && mock.trialEndsOn ? anchor.instant(`${mock.trialEndsOn}T09:00:00`) : null, currentPeriodEnd: anchor.instant(`${run.sub.renewsOn}T09:00:00`),
      cancelAtPeriodEnd: false, provider: null, providerCustomerId: null, providerSubscriptionId: null, checkoutSessionId: null,
    },
    now,
  )

  if (run.full) await seedDataset(tx, run, tenantId, actor, counts, warnings)

  await recordAudit(tx, tenantId, { action: "tenant.demo_seeded", entity: "tenant", entityId: tenantId, actorId: ownerId, before: null, after: { anchor: anchor.today, full: run.full, counts } }, now)
  return { counts, warnings }
}

async function seedDataset(tx: TenantTx, run: TenantRun, tenantId: string, actor: { userId: string }, counts: TenantCounts, warnings: string[]): Promise<void> {
  const { src, anchor, now, tz, ownerId, people, byMock, byName, userIds } = run
  const uid = (p: Person): string => userIds.get(p.email)!
  const userOfMock = (pid: string): string => {
    const p = byMock.get(pid)
    if (!p) throw new Error(`the mock names a person this seed does not know: ${pid}`)
    return uid(p)
  }
  const userOfName = (name: string): string => {
    const p = byName.get(name)
    if (!p) throw new Error(`the mock names a person this seed does not know: ${name}`)
    return uid(p)
  }

  // ---- memberships: role KEYS from the mock, ids from this tenant's role templates ----
  const roleIds = new Map((await tx.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.tenantId, tenantId))).map((r) => [r.key, r.id]))
  let joined = 0
  for (const p of people) {
    const roleId = roleIds.get(p.roleKey)
    if (!roleId) throw new Error(`the mock names a role this tenant lacks: ${p.roleKey}`)
    const userId = uid(p)
    const [m] = await tx.select({ roleId: memberships.roleId, status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    const status = p.active ? "active" : "deactivated"
    if (!m) {
      await tx.insert(memberships).values({ tenantId, userId, roleId, status, joinedAt: now })
      await recordAudit(tx, tenantId, { action: "member.joined", entity: "membership", entityId: userId, actorId: userId, before: null, after: { userId, roleKey: p.roleKey, seeded: true } }, now)
      joined++
    } else if (m.roleId !== roleId || m.status !== status) {
      await tx.update(memberships).set({ roleId, status }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    }
    // the search indexer reads the member's final row (every run: the index was wiped with the rest of the tenant's seeded data)
    if (p.active) await publish(tx, { tenantId, type: "member.joined", payload: { userId, roleKey: p.roleKey }, actorId: userId }, now)
  }
  counts.memberships = people.length
  counts.membersJoined = joined

  // ---- teams (departments), their members and the reporting lines ----
  const teamIds = new Map<string, string>()
  for (const d of src.departments) teamIds.set(d.name, (await createTeam(tx, tenantId, actor, { name: d.name, kind: "department" }, now)).id)
  for (const [name, teamId] of teamIds) {
    const members = people.filter((p) => p.teams.includes(name)).map(uid)
    await setTeamMembers(tx, tenantId, actor, teamId, members, now)
  }
  const teamOf = (dept: string): string | null => teamIds.get(dept) ?? null
  for (const p of people) if (p.managerEmail) await setManager(tx, tenantId, actor, uid(p), userIds.get(p.managerEmail)!, now)
  counts.teams = teamIds.size
  counts.reportingLines = people.filter((p) => p.managerEmail).length

  // ---- shifts: patterns, assignments, reporting defaults (the services, with a context for the demo owner) ----
  const role = await lockActor(tx, tenantId, ownerId, "shifts", "write")
  const sctx: ShiftCtx = { tenantId, tz, me: ownerId, actorId: ownerId, role, view: "all", write: "all", reports: [], now }
  const patternIds = new Map<string, string>()
  for (const p of src.patterns) {
    const teamId = teamOf(p.team)
    if (!teamId) throw new Error(`pattern ${p.id} names an unknown team`)
    patternIds.set(p.id, (await createPattern(tx, sctx, { name: p.name, teamId, start: p.start, end: p.end, days: p.days, timeZone: p.timeZone ?? null })).id)
  }
  for (const a of src.assignments) {
    await createAssignment(tx, sctx, { userId: userOfMock(a.personId), patternId: patternIds.get(a.patternId)!, from: anchor.day(a.from), until: a.until ? anchor.day(a.until) : null })
  }
  for (const [team, on] of Object.entries(src.reporting.teamDefaults)) if (teamOf(team)) await setTeamReporting(tx, sctx, teamOf(team)!, on)
  for (const [pid, on] of Object.entries(src.reporting.overrides)) await setPersonReporting(tx, sctx, userOfMock(pid), on)
  counts.patterns = patternIds.size
  counts.assignments = src.assignments.length

  // ---- devices: registered, never bound (no enrolment code and no binding secret exist; the enrolment flow is how a browser becomes "the company PC") ----
  const byUserMock = new Map(src.users.map((u) => [u.id, byMock.get(u.id)!]))
  for (const d of src.devices) {
    const owner = byUserMock.get(d.userId)
    if (!owner) throw new Error(`device ${d.id} names an unknown user`)
    const dev = await registerDevice(tx, tenantId, actor, { userId: uid(owner), type: d.type, owner: d.owner, label: d.label, trusted: d.trusted }, now)
    await tx.execute(sql`update devices set last_seen_at = ${anchor.instant(d.lastSeen)} where id = ${dev.id} and tenant_id = ${tenantId}`)
  }
  for (const p of src.devicePolicies) await setPolicy(tx, tenantId, actor, p.feature as "drive", p.allow as "trusted-company-pc", now)
  counts.devices = src.devices.length

  // ---- projects, milestones, templates (the task services) ----
  const trole = await lockActor(tx, tenantId, ownerId, "tasks", "write")
  const tctx: TaskCtx = { tenantId, tz, me: ownerId, actorId: ownerId, role: trole, scope: { kind: "all" } satisfies TaskScope, reports: [], drive: true, now }
  const projectIds = new Map<string, string>()
  const milestoneIds = new Map<string, string>()
  for (const p of src.projects) {
    const created = await createProject(tx, tctx, { name: p.name, teamId: teamOf(p.dept), leadId: userOfMock(p.lead), description: p.description, due: anchor.day(p.due) })
    projectIds.set(p.id, created.id)
    for (const m of p.milestones) milestoneIds.set(m.id, (await createMilestone(tx, tctx, created.id, { name: m.name, due: anchor.day(m.due) })).id)
  }
  for (const t of src.templates) {
    await createTemplate(tx, tctx, {
      name: t.name, title: t.title, description: t.description, teamId: teamOf(t.dept), priority: t.priority, tags: t.tags, dueOffset: t.dueOffset, dueTime: t.dueTime,
      evidenceRule: { mode: t.evidenceRule.mode, types: t.evidenceRule.types, min: t.evidenceRule.min, instruction: t.evidenceRule.instruction, review: t.evidenceRule.review } as never,
    })
  }
  counts.projects = src.projects.length
  counts.milestones = milestoneIds.size
  counts.templates = src.templates.length

  // ---- tasks and reports ----
  const world = {
    tenantId, now, anchor, actorId: ownerId, userOfMock, userOfName, teamId: teamOf,
    projectId: (m: string) => projectIds.get(m) ?? null, milestoneId: (m: string) => milestoneIds.get(m) ?? null,
  }
  const seeded = await seedTasks(tx, world, src.tasks)
  counts.tasks = src.tasks.length
  counts.taskEvidence = src.tasks.reduce((n, t) => n + t.evidence.length, 0)
  const patternById = new Map(src.patterns.map((p) => [p.id, p]))
  const rep = await seedReports(tx, {
    tenantId, tz, now, anchor, actorId: ownerId, dueAfterMinutes: src.reporting.reportDueAfterMinutes, userOfMock, userOfName,
    patternId: (m) => patternIds.get(m)!, teamId: (d) => teamOf(d)!, pattern: (m) => patternById.get(m)!, taskIds: seeded.ids,
  }, src.reports)
  counts.reports = src.reports.length
  if (seeded.evidenceFiles > 0) warnings.push(`${seeded.evidenceFiles} task evidence files are metadata only: the seed writes no objects to storage, so opening one fails`)
  if (rep.attachmentsSkipped > 0) warnings.push(`${rep.attachmentsSkipped} report attachments were skipped (files need object storage)`)

  // ---- notifications of the demo's signed-in person (in-app only; no delivery rows, so nothing is ever sent) ----
  const me = byName.get(src.shellUser.name)
  let seededNotes = 0
  if (me) {
    for (const n of src.notifications) {
      if (/payroll/i.test(n.title)) continue // payroll has no backend module (stays on the mock)
      const kind = /report/i.test(n.title) ? "report" : n.type === "manager-action" ? "system" : "task"
      const at = anchor.instant(n.at)
      await tx.insert(notifications).values({ id: detId(tenantId, "notification", n.id), tenantId, userId: uid(me), kind, title: n.title, body: "", link: n.href, inApp: true, createdAt: at, readAt: n.read ? at : null })
      seededNotes++
    }
  }
  counts.notifications = seededNotes
}
