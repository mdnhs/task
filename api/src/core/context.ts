import type { Role } from "@opsdesk/domain/permissions"
import type { Deps } from "../deps"

/** The caller's role in the current tenant, loaded once per request by requirePermission. */
export type ResolvedRole = Role & { key: string; fieldRules: Record<string, string[]> }

// device type arrives with T1.6; kept loose until then.
export type AppEnv = {
  Variables: {
    deps: Deps
    requestId: string
    session?: { id: string; userId: string; lastSeenAt: Date; mfaPassed: boolean }
    user?: { id: string; email: string }
    tenant?: { id: string; slug: string; timezone: string; currency: string; locale: string; sessionIdleHours: number }
    member?: { userId: string; roleId: string; roleKey: string }
    role?: ResolvedRole
    device?: unknown
  }
}
