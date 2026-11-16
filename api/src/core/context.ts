import type { Deps } from "../deps"

// role/device types arrive with @opsdesk/domain (T1.x); kept loose until then.
export type AppEnv = {
  Variables: {
    deps: Deps
    requestId: string
    session?: { id: string; userId: string; lastSeenAt: Date; mfaPassed: boolean }
    user?: { id: string; email: string }
    tenant?: { id: string; slug: string; timezone: string; currency: string; locale: string; sessionIdleHours: number }
    member?: { userId: string; roleId: string; roleKey: string }
    role?: unknown
    device?: unknown
  }
}
