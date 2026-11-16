import type { Role } from "@opsdesk/domain/permissions"
import type { Device, DevicePolicy } from "@opsdesk/domain/devices"
import type { MfaPolicy } from "@opsdesk/domain/mfa"
import type { Deps } from "../deps"

/** The caller's role in the current tenant, loaded once per request by requirePermission. */
export type ResolvedRole = Role & { key: string; fieldRules: Record<string, string[]> }

export type AppEnv = {
  Variables: {
    deps: Deps
    requestId: string
    session?: { id: string; userId: string; lastSeenAt: Date; mfaPassed: boolean }
    user?: { id: string; email: string; twoFactorEnabled: boolean }
    tenant?: { id: string; slug: string; timezone: string; currency: string; locale: string; sessionIdleHours: number; mfaPolicy: MfaPolicy }
    member?: { userId: string; roleId: string; roleKey: string }
    role?: ResolvedRole
    /** The device of THIS request (loadDevice, every tenant request); the unregistered browser when the cookie does not resolve. */
    device?: Device
    /** The tenant's device policies as read for THIS request (never cached across requests). */
    devicePolicies?: DevicePolicy[]
  }
}
