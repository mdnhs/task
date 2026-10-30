import { cookies } from "next/headers"

import { getData } from "@/lib/data"
import { getEntitlementsData } from "@/lib/entitlements-data"
import { getSupportAccess } from "@/lib/support-data"
import type { NavigationData } from "@/lib/types"
import { isStaffRole } from "./permissions"
import type { AuditEntry, DataRequest, Invoice, Plan, PlatformSeed, PlatformSettings, PlatformTenant, StaffMember, SubEvent, UsagePoint } from "./types"

export const getPlatformNav = () => getData<NavigationData>("platform/navigation.json")

// Plans are the billing module's seed: read the JSON, never import features/billing.
export async function getPlatformSeed(): Promise<PlatformSeed> {
  const [{ tenants }, plans, entitlements, requests, { entries }, { events }, { invoices }, { usage }, { requests: dataRequests }] = await Promise.all([
    getData<{ tenants: PlatformTenant[] }>("platform/tenants.json"),
    getData<Plan[]>("billing/plans.json"),
    getEntitlementsData(),
    getSupportAccess(),
    getData<{ entries: AuditEntry[] }>("platform/audit.json"),
    getData<{ events: SubEvent[] }>("platform/subscriptions.json"),
    getData<{ invoices: Invoice[] }>("platform/invoices.json"),
    getData<{ usage: Record<string, UsagePoint[]> }>("platform/usage.json"),
    getData<{ requests: DataRequest[] }>("platform/data-requests.json"),
  ])
  return { tenants, plans, entitlements, requests, audit: entries, subscriptions: events, invoices, usage, dataRequests }
}

export const getStaff = () => getData<{ operatorId: string; staff: StaffMember[] }>("platform/staff.json")

/**
 * The signed-in platform operator (D3): the staff member named by `operatorId` in platform/staff.json.
 * Dev only: an `od-staff-role` cookie overrides the role, to test what each staff role can open.
 */
export async function getOperator(): Promise<StaffMember> {
  const [{ operatorId, staff }, jar] = await Promise.all([getStaff(), cookies()])
  const op = staff.find((s) => s.id === operatorId) ?? staff[0]
  const override = jar.get("od-staff-role")?.value
  if (process.env.NODE_ENV !== "production" && isStaffRole(override)) return { ...op, role: override }
  return op
}

export const getPlatformSettings = () => getData<PlatformSettings>("platform/settings.json")

/** Topbar environment pill (D1): from the payment provider's mode in platform settings. */
export async function getPlatformEnv(): Promise<{ label: string; live: boolean }> {
  const { payments } = await getPlatformSettings()
  const live = payments.mode === "live"
  return { label: live ? "Live" : "Test mode", live }
}
