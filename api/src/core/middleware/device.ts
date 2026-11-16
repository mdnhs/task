import { createHmac } from "node:crypto"
import { canUse, parsePolicies, resolveDevice, type Device, type DeviceFeature } from "@opsdesk/domain/devices"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import { getSignedCookie, setSignedCookie } from "hono/cookie"
import type { AppEnv } from "../context"
import { devicePolicies, devices } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { Forbidden, Unauthorized } from "../errors"

export const DEVICE_COOKIE = "od-device"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEEN_EVERY_MS = 5 * 60_000

/** Cookie signing key: derived from BETTER_AUTH_SECRET under its own context string, so it is never the raw secret
 *  and a device cookie signature cannot be replayed as anything else signed with that secret. */
const cookieKey = (secret: string) => createHmac("sha256", secret).update("opsdesk:device-cookie:v1").digest("base64")

export type DeviceRow = typeof devices.$inferSelect
export const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.userId,
  type: r.type,
  owner: r.owner,
  label: r.label,
  trusted: r.trusted,
  lastSeen: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
})

/** Binds the device to this browser: a signed, HttpOnly cookie holding only the device id. Called by the device's own user. */
export async function setDeviceCookie(c: Context<AppEnv>, deviceId: string): Promise<void> {
  const env = c.get("deps").env
  await setSignedCookie(c, DEVICE_COOKIE, deviceId, cookieKey(env.BETTER_AUTH_SECRET), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 400 * 24 * 60 * 60, // the longest lifetime browsers honour
  })
}

/**
 * Resolves the device of THIS request (FR-M0-10) and the tenant's device policies, fresh from the database each time
 * (no cache, so a revoked trust or a changed policy bites on the next request). requireTenant runs it, so every tenant
 * route has it by construction. A missing, tampered, unknown, other-user's or other-tenant's cookie is the unregistered browser.
 */
export const loadDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const tenant = c.get("tenant")
  const member = c.get("member")
  if (!tenant || !member) throw Unauthorized("unauthenticated") // fail closed
  const deps = c.get("deps")
  const signed = await getSignedCookie(c, cookieKey(deps.env.BETTER_AUTH_SECRET), DEVICE_COOKIE) // false when tampered
  const id = typeof signed === "string" && UUID.test(signed) ? signed : undefined
  const now = deps.clock.now()

  const { device, policies } = await withTenant(deps.db, tenant.id, async (tx) => {
    const policyRows = await tx.select().from(devicePolicies).where(eq(devicePolicies.tenantId, tenant.id))
    const parsed = parsePolicies(policyRows.map((r) => ({ feature: r.feature, allow: r.allow })))
    if (!parsed) throw new Error("device_policies rows failed validation") // fail closed (500), never "open"
    let rows: DeviceRow[] = []
    if (id) {
      rows = await tx.select().from(devices).where(and(eq(devices.id, id), eq(devices.tenantId, tenant.id), eq(devices.userId, member.userId)))
      if (rows[0]) {
        const stale = new Date(now.getTime() - SEEN_EVERY_MS)
        const [touched] = await tx
          .update(devices)
          .set({ lastSeenAt: now })
          .where(and(eq(devices.id, id), eq(devices.tenantId, tenant.id), or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, stale))))
          .returning({ id: devices.id })
        if (touched) rows = [{ ...rows[0], lastSeenAt: now }]
      }
    }
    return { device: resolveDevice(id, member.userId, rows.map(toDevice)), policies: parsed }
  })
  c.set("device", device)
  c.set("devicePolicies", policies)
  await next()
}

/** True when the Drive policy lets THIS request's device see Drive links. Fails closed if loadDevice has not run. */
export function driveAllowed(c: Context<AppEnv>): boolean {
  const policies = c.get("devicePolicies")
  return policies ? canUse("drive", c.get("device"), policies) : false
}

/** 403 `device_policy` when the tenant's policy for `feature` excludes this request's device (after requireTenant). */
export function requireFeatureOnDevice(feature: DeviceFeature): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const policies = c.get("devicePolicies")
    if (!policies || !canUse(feature, c.get("device"), policies)) throw Forbidden("device_policy")
    await next()
  }
}
