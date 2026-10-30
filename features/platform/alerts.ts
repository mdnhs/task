import { nowIso } from "./logic"
import type { PlatformTenant, SupportRequest } from "./types"

// The platform bell (D1): computed from the seed, never stored. Same shape as the shell's Notification.
export type PlatformAlert = { id: string; type: "payment" | "access" | "trial"; title: string; at: string; read: boolean; href: string }

/** Days before a trial ends that it shows in the bell. */
export const TRIAL_ALERT_DAYS = 7

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

export function platformAlerts(tenants: PlatformTenant[], requests: SupportRequest[], today: string): PlatformAlert[] {
  const now = nowIso(today)
  const name = new Map(tenants.map((t) => [t.id, t.name]))
  const tenantHref = (id: string) => `/platform/tenants/${encodeURIComponent(id)}`
  const out: PlatformAlert[] = [
    ...tenants
      .filter((t) => t.status === "past_due")
      .map((t) => ({ id: `pay-${t.id}`, type: "payment" as const, title: `Payment failed: ${t.name}`, at: t.billing.lastInvoice?.at ?? now, read: false, href: tenantHref(t.id) })),
    ...requests
      .filter((r) => r.status === "requested")
      .map((r) => ({ id: `acc-${r.id}`, type: "access" as const, title: `Support access awaiting approval: ${name.get(r.tenantId) ?? r.tenantId}`, at: r.requestedAt, read: false, href: "/platform/support" })),
    ...tenants
      .filter((t) => {
        if (t.status !== "trial" || !t.billing.trialEndsOn) return false
        const left = (day(t.billing.trialEndsOn) - day(today)) / 86_400_000
        return left >= 0 && left <= TRIAL_ALERT_DAYS
      })
      .map((t) => ({ id: `trial-${t.id}`, type: "trial" as const, title: `Trial ends soon: ${t.name}`, at: now, read: false, href: tenantHref(t.id) })),
  ]
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
