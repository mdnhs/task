import { Live360Header, liveTabsFor, loadTenant360, requireStaff, unavailablePlatformPage } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../../../gate"
import { refused, settle } from "../../../../settle"
import { TenantNotFound } from "../t360"

// The tenant 360 shell (D9) on the API: the header and the tab seg stay mounted while the tab routes below it change, so the seg pill slides and only the tab body shows its skeleton
// ([tab]/loading.tsx). Gated on tenants.read. GET /v1/platform/tenants/{id} is aggregates only (counts and one date): never a member name or email.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return g.denied
  const { id } = await params
  const r = await settle(apiServer().then((api) => loadTenant360(api, id)))
  if (!r.ok) return refused(r.e, "platform tenants")
  if (!r.v) return <TenantNotFound />
  return (
    <>
      <Live360Header t={r.v} can={{ suspend: requireStaff(g.op, "tenants.suspend"), support: requireStaff(g.op, "support.request") }} tabs={liveTabsFor(g.op, !unavailablePlatformPage())} />
      {children}
    </>
  )
}
