import { LiveSupport, loadSupportGrants, loadTenantList } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Support access · Platform · OpsDesk" }

// Read-only support access (owner, support): pick a tenant, give a reason and hours. `?request=<tenantId>` preselects the tenant.
export default async function Page({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const g = await gate("support.request", "platform support access")
  if ("denied" in g) return g.denied
  const { request } = await searchParams
  const r = await settle(apiServer({ tenant: null }).then(async (api) => ({ list: await loadTenantList(api), grants: await loadSupportGrants(api) })))
  return r.ok ? <LiveSupport tenants={r.v.list.rows} grants={r.v.grants.items} requestFor={typeof request === "string" ? request : undefined} /> : refused(r.e, "platform support access")
}
