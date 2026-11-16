import { and, eq, like, sql } from "drizzle-orm"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import type { ResolvedRole } from "../../core/context"
import { memberships, roles } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { exceeds } from "./access"

export type RoleRow = typeof roles.$inferSelect
type Actor = { userId: string; role: ResolvedRole }

export const toRoleDto = (r: RoleRow) => ({
  id: r.id,
  key: r.key,
  label: r.label,
  description: r.description,
  home: r.home,
  access: r.access,
  fieldRules: r.fieldRules,
  isTemplate: r.isTemplate,
  clonedFrom: r.clonedFrom,
})

const snapshot = (r: Pick<RoleRow, "label" | "access" | "fieldRules">) => ({ label: r.label, access: r.access, fieldRules: r.fieldRules })

/** Throws 403 role_escalation if `target` grants more than the actor's own access on any module. */
export function assertNoEscalation(actor: ResolvedRole, target: Record<string, string>): void {
  if (exceeds(actor.access, target).length > 0) throw Forbidden("role_escalation")
}

async function roleIn(tx: TenantTx, tenantId: string, id: string): Promise<RoleRow> {
  const [r] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))) // RLS + explicit filter
  if (!r) throw NotFound("role_not_found")
  return r
}

export async function listRoles(tx: TenantTx, tenantId: string): Promise<RoleRow[]> {
  return tx.select().from(roles).where(eq(roles.tenantId, tenantId)).orderBy(roles.key)
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "role"

export async function cloneRole(tx: TenantTx, tenantId: string, actor: Actor, sourceId: string, label: string, now: Date): Promise<RoleRow> {
  const src = await roleIn(tx, tenantId, sourceId)
  const base = slug(label)
  const taken = new Set(
    (await tx.select({ key: roles.key }).from(roles).where(and(eq(roles.tenantId, tenantId), like(roles.key, `${base}%`)))).map((r) => r.key),
  )
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  const [row] = await tx
    .insert(roles)
    .values({
      tenantId, key, label, description: src.description, home: src.home,
      access: { ...src.access }, fieldRules: structuredClone(src.fieldRules), isTemplate: false, clonedFrom: src.id,
    })
    .returning()
  await recordAudit(
    tx, tenantId,
    { action: "role.cloned", entity: "role", entityId: row.id, actorId: actor.userId, before: null, after: { clonedFrom: src.id, key, ...snapshot(row) } },
    now,
  )
  return row
}

export async function updateRole(
  tx: TenantTx, tenantId: string, actor: Actor, id: string,
  patch: { label?: string; access?: Record<string, string>; fieldRules?: Record<string, string[]> }, now: Date,
): Promise<RoleRow> {
  const [cur] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).for("update")
  if (!cur) throw NotFound("role_not_found")
  if (cur.isTemplate) throw Conflict("template_locked")
  const access = patch.access ? { ...cur.access, ...patch.access } : cur.access
  assertNoEscalation(actor.role, access)
  const next = { label: patch.label ?? cur.label, access, fieldRules: patch.fieldRules ?? cur.fieldRules }
  const [row] = await tx.update(roles).set(next).where(eq(roles.id, id)).returning()
  await recordAudit(
    tx, tenantId,
    { action: "role.updated", entity: "role", entityId: id, actorId: actor.userId, before: snapshot(cur), after: snapshot(row) },
    now,
  )
  return row
}

export async function changeMemberRole(
  tx: TenantTx, tenantId: string, actor: Actor, userId: string, roleId: string, now: Date,
): Promise<{ userId: string; roleId: string; roleKey: string }> {
  // One member-role change at a time per tenant: with row locks alone, two owners demoting each other lock each other's
  // row first and then deadlock on the owner count. The FOR UPDATE locks below stay as defence in depth.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"member-roles:" + tenantId}))`)
  const target = await roleIn(tx, tenantId, roleId)
  // Order matters for the 404/403 split: the new role must exist in this tenant before anything about the member is revealed.
  const [m] = await tx
    .select({ roleId: memberships.roleId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for("update")
  if (!m) throw NotFound("member_not_found")
  const cur = await roleIn(tx, tenantId, m.roleId)

  // No-escalation, both ways: nobody hands out a role above their own, nor changes a member who currently outranks them.
  assertNoEscalation(actor.role, target.access)
  assertNoEscalation(actor.role, cur.access)
  if (target.key === "owner" && actor.role.key !== "owner") throw Forbidden("role_escalation") // only owners create owners

  if (cur.key === "owner" && target.key !== "owner") {
    // Lock every active owner row (stable order) so two concurrent demotions cannot both pass the count.
    const owners = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.key, "owner")))
      .orderBy(memberships.userId)
      .for("update", { of: memberships })
    if (owners.length <= 1) throw new AppError(409, "last_owner", "Conflict")
  }

  await tx.update(memberships).set({ roleId }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  await recordAudit(
    tx, tenantId,
    {
      action: "member.role_changed", entity: "membership", entityId: userId, actorId: actor.userId,
      before: { roleId: cur.id, roleKey: cur.key, access: cur.access },
      after: { roleId: target.id, roleKey: target.key, access: target.access },
    },
    now,
  )
  return { userId, roleId: target.id, roleKey: target.key }
}

