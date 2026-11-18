import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LIVE_TABS, LiveAuditTab, LiveModulesTab, LiveOverviewTab, LiveTenantSupportTab, isLiveTab, isMockTab, liveTabAction, loadAudit, loadTenant360, requireStaff, unavailablePlatformPage, type TenantTab } from "@/features/platform"
import { apiServer } from "@/lib/api/server"
import { getEntitlementsData } from "@/lib/entitlements-data"

import { gate } from "../../../../../gate"
import { refused, settle } from "../../../../../settle"
import { Unavailable } from "../../../../../unavailable"
import { MockNotInSeed, MockTabBody, loadMock360 } from "../../t360"

export async function generateMetadata({ params }: { params: Promise<{ id: string; tab: string }> }): Promise<Metadata> {
  const { tab } = await params
  const label = LIVE_TABS.find((t) => t.id === tab)?.label
  return { title: `${label ? `${label} · ` : ""}Tenant · Platform · OpsDesk` }
}

// One tenant 360 tab (D9). Each tab gates on its own action (audit.read for audit), so a role without it sees "Access restricted" under the header and none of the tab's data is in the
// payload. Overview, modules, support and audit run on the API; billing, usage and settings are mock (I16) and shown only with ENABLE_MOCK_MODULES=1.
export default async function Page({ params }: { params: Promise<{ id: string; tab: string }> }) {
  const { id, tab } = await params
  if (!isLiveTab(tab)) notFound()
  const label = LIVE_TABS.find((t) => t.id === tab)!.label
  const g = await gate(liveTabAction(tab), `tenant ${label.toLowerCase()}`)
  if ("denied" in g) return g.denied
  if (isMockTab(tab)) {
    if (unavailablePlatformPage()) return <Unavailable label={label} />
    const v = await loadMock360(id, g.op)
    return v ? <MockTabBody tab={tab as "billing" | "usage" | "settings"} v={v} /> : <MockNotInSeed />
  }
  const r = await settle(apiServer({ tenant: null }).then(async (api) => {
    const t = await loadTenant360(api, id)
    return t ? { t, node: await liveBody(tab, t, g.op, api) } : null
  }))
  if (!r.ok) return refused(r.e, `tenant ${label.toLowerCase()}`)
  return r.v ? r.v.node : null // null: the layout shows "Tenant not found"
}

async function liveBody(tab: TenantTab, t: NonNullable<Awaited<ReturnType<typeof loadTenant360>>>, op: Parameters<typeof requireStaff>[0], api: Awaited<ReturnType<typeof apiServer>>) {
  switch (tab) {
    case "modules": {
      const ent = await getEntitlementsData()
      return <LiveModulesTab t={t} catalogue={ent.productModules} plans={ent.plans} core={ent.core ?? []} canEdit={requireStaff(op, "tenants.modules")} />
    }
    case "support":
      return <LiveTenantSupportTab t={t} canGrant={requireStaff(op, "support.request")} />
    case "audit":
      return <LiveAuditTab t={t} lines={await loadAudit(api, { targetTenantId: t.id, limit: 100 })} />
    default:
      return <LiveOverviewTab t={t} />
  }
}
