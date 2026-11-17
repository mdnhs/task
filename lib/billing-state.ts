// The company's billing state as the UI shows it (B6 T6.4, ruling I20). Pure: no React, no Next.
//   ok      normal.
//   grace   the trial is over; writes still work until the grace end (trial end + 7 days).
//   blocked non-GET tenant routes answer 402 billing_required. The session is read-only (lib/session-core.ts turns it into tenant.status "suspended", so
//           canWrite is false everywhere), every GET page keeps working, and billing plus the data export stay usable (C13).
import { formatDate } from "./dates"
import { can } from "./permissions"
import type { Role, Tenant } from "./types"
import { wallInTz } from "./tz"

export type BillingState = "ok" | "grace" | "blocked"

export const isReadOnly = (s: { billingState: BillingState }): boolean => s.billingState === "blocked"

/**
 * What a blocked (read-only) tenant may still do: manage billing (it is how they pay) and request the data export. The role decides, never the billing state:
 * `canWrite` is false for everyone while blocked, so these two must not use it. The API exempts the same routes (/v1/billing, data requests) and both are the
 * owner's (billing writes need the owner role key; the export, support access and deletion are Tenant Owner only, FR-SET-08).
 */
export function canWhileBlocked(s: { role: Role }, area: "billing" | "export"): boolean {
  const owner = s.role.id === "owner"
  switch (area) {
    case "billing": return can(s.role, "settings", "write") && owner
    case "export": return can(s.role, "settings", "write") && owner
  }
}

/** Who can open /settings/billing: the API answers its subscription and invoices to the owner or an admin only. */
export const canOpenBilling = (s: { role: Role }): boolean => s.role.id === "owner" || s.role.id === "admin"

export type BannerInput = {
  status: Tenant["status"]
  billingState: BillingState
  trialEndsAt: string | null
  graceEndsAt: string | null
  /** The tenant's own IANA zone and its readable name (Org.timezone, Org.tzLabel). */
  timezone: string
  tzLabel: string
  /** A write answered 402 in this browser before the page re-read the session. */
  forceBlocked?: boolean
  /** The viewer may open /settings/billing (the owner or an admin). Anyone else sees the message only: a link they cannot use is noise. */
  canBilling: boolean
}
export type Banner = { tone: "info" | "warn" | "danger"; text: string; action: { href: string; label: string } | null }

const BILLING = "/settings/billing"
const dayIn = (iso: string, tz: string) => formatDate(wallInTz(iso, tz))

/** The banner above every page, or null. Dates are the tenant's calendar days, not the viewer's or the server's. */
export function bannerOf(i: BannerInput): Banner | null {
  const link = (label: string) => (i.canBilling ? { href: BILLING, label } : null)
  if (i.forceBlocked || i.billingState === "blocked") {
    return { tone: "danger", text: "Read-only: subscription inactive. You can still export data.", action: link("Reactivate") }
  }
  // A "suspended" status with billing still fine is not a billing matter: the company was suspended by the platform (members then get 404 from the API, so this
  // is a defensive branch). It shows a neutral message and never the billing copy or link.
  if (i.status === "suspended") return { tone: "danger", text: "This workspace is suspended. Contact support.", action: null }
  if (i.billingState === "grace") {
    const by = i.graceEndsAt ? `by ${dayIn(i.graceEndsAt, i.timezone)} (${i.tzLabel}) ` : "soon "
    return { tone: "warn", text: `Trial ended. Choose a plan ${by}to keep editing.`, action: link("Choose a plan") }
  }
  if (i.status === "past_due") {
    return { tone: "warn", text: "Payment failed. Update billing to keep full access.", action: link("Update billing") }
  }
  if (i.status === "trial") {
    return { tone: "info", text: `Trial ends ${i.trialEndsAt ? `${dayIn(i.trialEndsAt, i.timezone)} (${i.tzLabel})` : "soon"}`, action: link("Choose a plan") }
  }
  return null
}
