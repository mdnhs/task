import { allowFor, DEVICE_FEATURES, type DeviceAllow, type DeviceFeature, type DeviceOwner, type DeviceType, type Device } from "@opsdesk/domain/devices"
import { and, asc, eq, sql } from "drizzle-orm"
import { toDevice } from "../../core/middleware/device"
import { AppError, NotFound } from "../../core/errors"
import { devicePolicies, devices, memberships } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { lockActor } from "../rbac"

type Actor = { userId: string }

export const NotAMember = () => new AppError(422, "not_a_member", "Unprocessable Entity")

// Advisory lock namespace for device / policy mutations ("dev!"): one writer per tenant, taken first, so the audited
// before-value of a policy upsert (where the row may not exist yet to lock) is always the real previous value.
const DEVICE_LOCK_NS = 0x64657621

async function begin(tx: TenantTx, tenantId: string, actor: Actor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${DEVICE_LOCK_NS}::int, hashtext(${tenantId}::text))`)
  await lockActor(tx, tenantId, actor.userId, "settings", "write") // R25: re-checked inside the tx
}

const snapshot = (d: Device) => ({ userId: d.userId, type: d.type, owner: d.owner, label: d.label, trusted: d.trusted })

/** Admins (settings:write) see every device of the tenant; anyone else sees only their own. */
export async function listDevices(tx: TenantTx, tenantId: string, actor: Actor): Promise<Device[]> {
  let all = true
  try {
    await lockActor(tx, tenantId, actor.userId, "settings", "write")
  } catch (e) {
    if (!(e instanceof AppError) || e.status !== 403) throw e
    all = false
  }
  const rows = await tx
    .select()
    .from(devices)
    .where(and(eq(devices.tenantId, tenantId), ...(all ? [] : [eq(devices.userId, actor.userId)])))
    .orderBy(asc(devices.label), asc(devices.id))
  return rows.map(toDevice)
}

export async function registerDevice(
  tx: TenantTx, tenantId: string, actor: Actor,
  input: { userId: string; type: DeviceType; owner: DeviceOwner; label: string; trusted: boolean }, now: Date,
): Promise<Device> {
  await begin(tx, tenantId, actor)
  const [m] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, input.userId)))
  if (!m) throw NotAMember()
  const [row] = await tx.insert(devices).values({ tenantId, ...input }).returning()
  const d = toDevice(row)
  await recordAudit(tx, tenantId, { action: "device.registered", entity: "device", entityId: d.id, actorId: actor.userId, before: null, after: snapshot(d) }, now)
  return d
}

/** The allocated user is immutable (a device never moves to another person), so it is not patchable. */
export async function updateDevice(
  tx: TenantTx, tenantId: string, actor: Actor, id: string,
  patch: { type?: DeviceType; owner?: DeviceOwner; label?: string; trusted?: boolean }, now: Date,
): Promise<Device> {
  await begin(tx, tenantId, actor)
  const [cur] = await tx.select().from(devices).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId))).for("update")
  if (!cur) throw NotFound("device_not_found")
  const [row] = await tx.update(devices).set(patch).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId))).returning()
  await recordAudit(tx, tenantId, { action: "device.updated", entity: "device", entityId: id, actorId: actor.userId, before: snapshot(toDevice(cur)), after: snapshot(toDevice(row)) }, now)
  return toDevice(row)
}

/**
 * Binding: only the user the device is allocated to may bind it, and only for their own session. Anyone else gets 404
 * (the same as a missing device), so an admin can never mint a cookie that makes their browser look like another user's PC.
 */
export async function bindDevice(tx: TenantTx, tenantId: string, actor: Actor, id: string, now: Date): Promise<Device> {
  const [row] = await tx.select().from(devices).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId), eq(devices.userId, actor.userId)))
  if (!row) throw NotFound("device_not_found")
  const d = toDevice(row)
  await recordAudit(tx, tenantId, { action: "device.bound", entity: "device", entityId: id, actorId: actor.userId, before: null, after: snapshot(d) }, now)
  return d
}

export type PolicyDto = { feature: DeviceFeature; allow: DeviceAllow }

/** Effective policy per feature (no row = "any"). */
export async function listPolicies(tx: TenantTx, tenantId: string): Promise<PolicyDto[]> {
  const rows = await tx.select().from(devicePolicies).where(eq(devicePolicies.tenantId, tenantId))
  const set = rows.map((r) => ({ feature: r.feature, allow: r.allow }))
  return DEVICE_FEATURES.map((f) => ({ feature: f.value, allow: allowFor(f.value, set) }))
}

export async function setPolicy(tx: TenantTx, tenantId: string, actor: Actor, feature: DeviceFeature, allow: DeviceAllow, now: Date): Promise<PolicyDto> {
  await begin(tx, tenantId, actor)
  const [prev] = await tx.select().from(devicePolicies).where(and(eq(devicePolicies.tenantId, tenantId), eq(devicePolicies.feature, feature)))
  await tx.insert(devicePolicies).values({ tenantId, feature, allow }).onConflictDoUpdate({ target: [devicePolicies.tenantId, devicePolicies.feature], set: { allow } })
  await recordAudit(tx, tenantId, { action: "device_policy.set", entity: "device_policy", entityId: feature, actorId: actor.userId, before: { allow: prev?.allow ?? "any" }, after: { allow } }, now)
  return { feature, allow }
}

