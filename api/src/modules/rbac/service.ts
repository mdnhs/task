import { and, eq, like, sql } from "drizzle-orm"
import { can, type Access, type Module } from "@opsdesk/domain/permissions"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import type { ResolvedRole } from "../../core/context"
import { memberships, roles } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { publish } from "../../core/events"
import { recordAudit } from "../audit"
import { API_KEY_ACTOR_PREFIX } from "../../core/middleware/principal"
import { lockApiKeyActor } from "../api-keys/lock"
import { exceeds } from "./access"

export type RoleRow = typeof roles.$inferSelect
type Actor = { userId: string }

export type RosterLevel = "office" | "supervisor"
/** The column is a checked text ('office' | 'supervisor' | null); anything else reads as no level. */
const asRosterLevel = (v: string | null): RosterLevel | null => (v === "office" || v === "supervisor" ? v : null)
const LEVEL_RANK: Record<RosterLevel, number> = { supervisor: 1, office: 2 }
const levelRank = (v: RosterLevel | null): number => (v ? LEVEL_RANK[v] : 0)

/**
 * Roster level escalation (R8-3, carry-in of the B8 review): a caller cannot hand out a roster level higher than their own (office > supervisor > none),
 * through a clone or a PATCH. The caller's level is the `roster_level` of their role, read in the same tx (after lockActor).
 */
async function assertLevelNotAbove(tx: TenantTx, tenantId: string, actor: ResolvedRole, target: RosterLevel | null): Promise<void> {
  if (levelRank(target) === 0) return
  const [r] = await tx.select({ level: roles.rosterLevel }).from(roles).where(and(eq(roles.id, actor.id), eq(roles.tenantId, tenantId)))
  if (levelRank(target) > levelRank(asRosterLevel(r?.level ?? null))) throw Forbidden("role_escalation")
}

export const toRoleDto = (r: RoleRow) => ({
  id: r.id,
  key: r.key,
  label: r.label,
  description: r.description,
  home: r.home,
  access: r.access as Record<string, Access>, // validated on every write (AccessPatch); the column is jsonb
  fieldRules: r.fieldRules,
  rosterLevel: asRosterLevel(r.rosterLevel),
  isTemplate: r.isTemplate,
  clonedFrom: r.clonedFrom,
})

const snapshot = (r: Pick<RoleRow, "label" | "access" | "fieldRules" | "rosterLevel">) => ({ label: r.label, access: r.access, fieldRules: r.fieldRules, rosterLevel: asRosterLevel(r.rosterLevel) })

// Namespace for the two-key advisory lock, so RBAC cannot collide with the audit lock's single-key space.
const RBAC_LOCK_NS = 0x72626163 // "rbac"

/**
 * One RBAC mutation at a time per tenant (role edits, member role changes, clones). Take it FIRST, before lockActor and any
 * row lock: with row locks alone, holders of a role editing it (FOR SHARE on own role, FOR UPDATE on target) deadlock.
 */
export async function lockRbac(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${RBAC_LOCK_NS}::int, hashtext(${tenantId}::text))`)
}

/**
 * R25: re-reads the actor's membership + role INSIDE the mutation tx with FOR SHARE and re-checks the permission there,
 * so a concurrent demotion (which takes the row lock) either commits first and is seen, or waits for us. The request-level
 * cache in requirePermission stays for reads; mutations never trust it.
 */
export async function lockActor(tx: TenantTx, tenantId: string, userId: string, module: Module, need: "read" | "write"): Promise<ResolvedRole> {
  // API-key principal (T3.6): scopes ∩ the creator's current role, re-read here with the same locking (api-keys/lock.ts).
  if (userId.startsWith(API_KEY_ACTOR_PREFIX)) return lockApiKeyActor(tx, tenantId, userId.slice(API_KEY_ACTOR_PREFIX.length), module, need)
  const [row] = await tx
    .select({ role: roles, status: memberships.status })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for("share", { of: [memberships, roles] })
  if (!row || row.status !== "active") throw Forbidden("forbidden")
  const role: ResolvedRole = {
    id: row.role.id, key: row.role.key, label: row.role.label, description: row.role.description,
    home: row.role.home === "staff" ? "staff" : "manager",
    access: row.role.access as Record<Module, Access>, fieldRules: row.role.fieldRules,
  }
  if (!can(role, module, need)) throw Forbidden("forbidden")
  return role
}

/** Throws 403 role_escalation if `target` grants more than the actor's own access on any administrative module (R24). */
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

/** Defence in depth behind the api-key deny-list: role administration is for human members only (an api-key actor id is `apikey:<id>`). */
function humanActorOnly(actor: Actor): void {
  if (actor.userId.startsWith(API_KEY_ACTOR_PREFIX)) throw Forbidden("api_key_forbidden_route")
}

export async function cloneRole(tx: TenantTx, tenantId: string, actor: Actor, sourceId: string, label: string, now: Date): Promise<RoleRow> {
  humanActorOnly(actor)
  await lockRbac(tx, tenantId)
  const me = await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const src = await roleIn(tx, tenantId, sourceId)
  if (src.key === "owner") throw Conflict("owner_not_clonable")
  await assertLevelNotAbove(tx, tenantId, me, asRosterLevel(src.rosterLevel)) // the clone carries the source's roster level
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
      access: { ...src.access }, fieldRules: structuredClone(src.fieldRules), rosterLevel: src.rosterLevel, isTemplate: false, clonedFrom: src.id,
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
  patch: { label?: string; access?: Record<string, string>; fieldRules?: Record<string, string[]>; rosterLevel?: RosterLevel | null }, now: Date,
): Promise<RoleRow> {
  humanActorOnly(actor)
  await lockRbac(tx, tenantId)
  const me = await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const [cur] = await tx.select().from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).for("update")
  if (!cur) throw NotFound("role_not_found")
  if (cur.isTemplate) throw Conflict("template_locked")
  assertNoEscalation(me, cur.access) // never touch (rename, re-scope, demote) a role that outranks you, whatever the patch
  if (patch.access) assertNoEscalation(me, patch.access) // only the modules being set; others are unchanged
  if (patch.rosterLevel !== undefined || patch.access?.roster !== undefined) {
    // the EFFECTIVE level after the patch: granting roster access to a role that already carries a level activates that level, so it is judged like a grant
    const effective = patch.rosterLevel !== undefined ? patch.rosterLevel : asRosterLevel(cur.rosterLevel)
    await assertLevelNotAbove(tx, tenantId, me, effective) // never grant or activate a level above your own
    await assertLevelNotAbove(tx, tenantId, me, asRosterLevel(cur.rosterLevel)) // nor re-level (demote or clear) a role that outranks you
  }
  const access = patch.access ? { ...cur.access, ...patch.access } : cur.access
  const next = { label: patch.label ?? cur.label, access, fieldRules: patch.fieldRules ?? cur.fieldRules, rosterLevel: patch.rosterLevel !== undefined ? patch.rosterLevel : cur.rosterLevel }
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
  humanActorOnly(actor)
  await lockRbac(tx, tenantId)
  const me = await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const target = await roleIn(tx, tenantId, roleId)
  // Order matters for the 404/403 split: the new role must exist in this tenant before anything about the member is revealed.
  const [m] = await tx
    .select({ roleId: memberships.roleId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for("update")
  if (!m) throw NotFound("member_not_found")
  const cur = await roleIn(tx, tenantId, m.roleId)

  // R24: administrative-module escalation both ways, and the owner role is only given or taken by an owner.
  assertNoEscalation(me, target.access)
  assertNoEscalation(me, cur.access)
  await assertLevelNotAbove(tx, tenantId, me, asRosterLevel(target.rosterLevel)) // never assign a role whose roster level exceeds your own (yourself included)
  if ((target.key === "owner" || cur.key === "owner") && me.key !== "owner") throw Forbidden("role_escalation")

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
  await publish(
    tx,
    { tenantId, type: "member.role_changed", payload: { userId, fromRoleKey: cur.key, toRoleKey: target.key }, actorId: actor.userId },
    now,
  )
  return { userId, roleId: target.id, roleKey: target.key }
}

