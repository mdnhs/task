// The live tenant 360 tabs (B6 T6.8). Overview, modules, support and audit run on the API. Billing, usage and settings (slug, deletion, tenant data export) have no API route; they are
// listed only on a demo deployment (ENABLE_MOCK_MODULES=1, ruling I16) and then show the mock seed.
import { requireStaff } from "./permissions"
import type { PlatformAction, StaffMember, TenantTab } from "./types"

export const LIVE_TABS: { id: TenantTab; label: string; action: PlatformAction; mock?: boolean }[] = [
  { id: "overview", label: "Overview", action: "tenants.read" },
  { id: "billing", label: "Billing", action: "billing.read", mock: true },
  { id: "usage", label: "Usage", action: "tenants.read", mock: true },
  { id: "modules", label: "Modules", action: "tenants.read" },
  { id: "support", label: "Support", action: "tenants.read" },
  { id: "audit", label: "Audit", action: "audit.read" },
  { id: "settings", label: "Settings", action: "tenants.read", mock: true },
]
export const isLiveTab = (v: unknown): v is TenantTab => LIVE_TABS.some((t) => t.id === v)
export const liveTabAction = (tab: TenantTab): PlatformAction => LIVE_TABS.find((t) => t.id === tab)!.action
export const isMockTab = (tab: TenantTab): boolean => !!LIVE_TABS.find((t) => t.id === tab)?.mock
/** Tabs the operator may open: their role allows the action, and unbacked ones only when the mock flag is on. */
export const liveTabsFor = (op: StaffMember, mock: boolean): TenantTab[] => LIVE_TABS.filter((t) => requireStaff(op, t.action) && (mock || !t.mock)).map((t) => t.id)
