import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { TENANT_TABS, getPlatformSeed, isTenantTab, tabAction } from "@/features/platform"

import { gate } from "../../../../../gate"
import { TabBody, load360 } from "../../t360"

export async function generateMetadata({ params }: { params: Promise<{ id: string; tab: string }> }): Promise<Metadata> {
  const { id, tab } = await params
  const name = (await getPlatformSeed()).tenants.find((t) => t.id === id)?.name ?? "Tenant"
  const label = TENANT_TABS.find((t) => t.id === tab)?.label
  return { title: `${label ? `${label} · ` : ""}${name} · Platform · OpsDesk` }
}

// One tenant 360 tab (D9). Each tab gates on its own action (billing.read for billing, audit.read for audit), so a
// role without it sees "Access restricted" under the header and none of the tab's data is in the payload.
export default async function Page({ params }: { params: Promise<{ id: string; tab: string }> }) {
  const { id, tab } = await params
  if (!isTenantTab(tab)) notFound()
  const label = TENANT_TABS.find((t) => t.id === tab)!.label.toLowerCase()
  const g = await gate(tabAction(tab), `tenant ${label}`)
  if ("denied" in g) return g.denied
  const v = await load360(id, g.op)
  if (!v) return null // the layout shows "Tenant not found"
  return <TabBody tab={tab} v={v} />
}
