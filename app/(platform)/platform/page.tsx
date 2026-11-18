import { LiveOverview, loadMetrics, loadTenantList, requireStaff, unavailablePlatformPage } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../gate"
import { refused, settle } from "../settle"
import { MockOverview } from "./mock-overview"

export const metadata = { title: "Overview · Platform · OpsDesk" }

// The console overview on the API (B6 T6.8): KPIs from GET /v1/platform/metrics (MRR counts active subscriptions only, past due is separate, C11) and the tenant count. Roles without
// billing.read (support) get no revenue and no metrics request. The plan-mix, recent-activity and MRR-history cards need data the API does not have: they are sample data, shown only with
// ENABLE_MOCK_MODULES=1.
export default async function Page() {
  const g = await gate("tenants.read", "the platform overview")
  if ("denied" in g) return g.denied
  const canRevenue = requireStaff(g.op, "billing.read")
  const r = await settle(apiServer().then((api) => Promise.all([loadTenantList(api, { pageSize: 1 }), canRevenue ? loadMetrics(api) : null])))
  if (!r.ok) return refused(r.e, "the platform overview")
  const [list, metrics] = r.v
  return (
    <LiveOverview metrics={metrics} tenants={list.total} canRevenue={canRevenue} mock={!unavailablePlatformPage()}>
      <MockOverview op={g.op} />
    </LiveOverview>
  )
}
