import { randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { allowFor, DEVICE_FEATURES, type DeviceAllow, type DeviceFeature, type DeviceOwner, type DeviceType, type Device } from "@opsdesk/domain/devices"
import { and, asc, eq, sql } from "drizzle-orm"
import { sha256Hex, toDevice } from "../../core/middleware/device"
import { AppError, Conflict, NotFound } from "../../core/errors"
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

// Enrolment (R28, CR-02). The code is issued by an admin on the trusted PC, typed there by its allocated user.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32 symbols, no 0/O/1/I
const CODE_LENGTH = 10
const CODE_TTL_MS = 15 * 60_000
const MAX_WRONG = 5

/** Admin action: issues a one-time code (returned once, stored as sha256) AND resets the current binding. */
export async function issueEnrolment(tx: TenantTx, tenantId: string, actor: Actor, id: string, now: Date): Promise<{ code: string; expiresAt: string }> {
  await begin(tx, tenantId, actor)
  const [cur] = await tx.select().from(devices).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId))).for("update")
  if (!cur) throw NotFound("device_not_found")
  const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")
  const expires = new Date(now.getTime() + CODE_TTL_MS)
  await tx.update(devices).set({ enrolHash: sha256Hex(code), enrolExpiresAt: expires, enrolAttempts: 0, bindingHash: null }).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId)))
  await recordAudit(tx, tenantId, { action: "device.enrolment_issued", entity: "device", entityId: id, actorId: actor.userId, before: { bound: cur.bindingHash !== null }, after: { bound: false, expiresAt: expires.toISOString() } }, now)
  return { code, expiresAt: expires.toISOString() }
}

export type BindResult = { ok: true; device: Device; secret: string } | { ok: false }

/**
 * Binding: only the allocated user, with a valid unused unexpired code, and only while the device is unbound. Others get 404
 * (same as a missing device). A wrong code returns {ok:false} (not a throw) so the attempt counter COMMITS; 5 wrong invalidate the code.
 * Unknown / expired / used / invalidated codes are indistinguishable (no oracle).
 */
export async function bindDevice(tx: TenantTx, tenantId: string, actor: Actor, id: string, code: string, userAgent: string, now: Date): Promise<BindResult> {
  const [row] = await tx.select().from(devices).where(and(eq(devices.id, id), eq(devices.tenantId, tenantId), eq(devices.userId, actor.userId))).for("update")
  if (!row) throw NotFound("device_not_found")
  if (row.bindingHash) throw Conflict("device_already_bound")
  const live = row.enrolHash && row.enrolExpiresAt && row.enrolExpiresAt > now && row.enrolAttempts < MAX_WRONG
  if (!live || !code || !hashEq(row.enrolHash!, sha256Hex(code.trim().toUpperCase()))) {
    if (live) {
      const attempts = row.enrolAttempts + 1
      await tx.update(devices).set(attempts >= MAX_WRONG ? { enrolAttempts: attempts, enrolHash: null } : { enrolAttempts: attempts }).where(eq(devices.id, id))
    }
    return { ok: false }
  }
  const secret = randomBytes(32).toString("base64url")
  await tx.update(devices).set({ bindingHash: sha256Hex(secret), enrolHash: null, enrolExpiresAt: null, enrolAttempts: 0 }).where(eq(devices.id, id))
  const d = toDevice(row)
  await recordAudit(tx, tenantId, { action: "device.bound", entity: "device", entityId: id, actorId: actor.userId, before: { bound: false }, after: { bound: true, userAgentHash: sha256Hex(userAgent) } }, now)
  return { ok: true, device: d, secret }
}

const hashEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

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

