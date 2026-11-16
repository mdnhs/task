import type { Role } from "@opsdesk/domain/permissions"
import type { Device, DevicePolicy } from "@opsdesk/domain/devices"
import type { MfaPolicy } from "@opsdesk/domain/mfa"
import type { Deps } from "../deps"

/** The caller's role in the current tenant, loaded once per request by requirePermission. */
export type ResolvedRole = Role & { key: string; fieldRules: Record<string, string[]> }

export type PlatformRole = "owner" | "support" | "billing" | "viewer"

export type AppEnv = {
  Variables: {
    deps: Deps
    requestId: string
    session?: { id: string; userId: string; lastSeenAt: Date; mfaPassed: boolean }
    user?: { id: string; email: string; twoFactorEnabled: boolean }
    tenant?: { id: string; slug: string; timezone: string; currency: string; locale: string; sessionIdleHours: number; mfaPolicy: MfaPolicy }
    member?: { userId: string; roleId: string; roleKey: string }
    /** Set ONLY on the support-grant path of requireTenant (T3.5): the caller is platform staff reading under this grant. */
    support?: { grantId: string; staffUserId: string }
    role?: ResolvedRole
    /** The caller's platform staff identity (requirePlatformStaff, /v1/platform/* only). */
    staff?: { userId: string; role: PlatformRole }
    /** The device of THIS request (loadDevice, every tenant request); the unregistered browser when the cookie does not resolve. */
    device?: Device
    /** The tenant's device policies as read for THIS request (never cached across requests). */
    devicePolicies?: DevicePolicy[]
  }
}
