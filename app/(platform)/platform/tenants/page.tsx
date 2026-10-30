import { TenantsView, getPlatformSeed, isTenantView, tenantsData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Tenants · Platform · OpsDesk" }

// The tenants list (D2, Task 4). The view model is built here on the server (tenants.ts): no usage points, invoices or
// support requests reach the client, and no amount for a staff role without billing.read. `?view=` picks a saved view.
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const g = await gate("tenants.read", "platform tenants")
  if ("denied" in g) return g.denied
  const [seed, org, { view }] = await Promise.all([getPlatformSeed(), getOrg(), searchParams])
  return <TenantsView data={tenantsData(seed, g.op)} view={isTenantView(view) ? view : "all"} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
