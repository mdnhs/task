import { and, eq } from "drizzle-orm"
import type { ChannelPrefs } from "../../db/schema"
import { notificationPreferences } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"

export const KINDS = ["invite", "member", "file", "security", "dsr", "billing", "system", "task", "report"] as const
export type NotificationKind = (typeof KINDS)[number]
export type Resolved = Record<NotificationKind, Required<ChannelPrefs>>

/** Defaults: in-app on for every kind; email on for invite|security|dsr|billing (not task or report); push on for every kind (when a token exists). */
const EMAIL_BY_DEFAULT: readonly NotificationKind[] = ["invite", "security", "dsr", "billing"]

/** Defaults overlaid with the user's per-kind overrides. `security` can never lose in-app or email. */
export function resolveChannels(overrides: Record<string, ChannelPrefs> | null | undefined): Resolved {
  const out = {} as Resolved
  for (const k of KINDS) {
    const o = overrides && Object.hasOwn(overrides, k) ? overrides[k] : undefined
    out[k] = { inApp: o?.inApp ?? true, email: o?.email ?? EMAIL_BY_DEFAULT.includes(k), push: o?.push ?? true }
    if (k === "security") out[k] = { ...out[k], inApp: true, email: true }
  }
  return out
}

export type Prefs = { channels: Resolved; quietStart: string | null; quietEnd: string | null }

const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null)

export async function loadPrefs(tx: TenantTx, tenantId: string, userId: string): Promise<Prefs> {
  const [r] = await tx
    .select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.tenantId, tenantId), eq(notificationPreferences.userId, userId)))
  return { channels: resolveChannels(r?.channels), quietStart: hhmm(r?.quietStart ?? null), quietEnd: hhmm(r?.quietEnd ?? null) }
}
