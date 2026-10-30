import { OverviewDashboard, getPlatformSeed, overviewData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../gate"

export const metadata = { title: "Overview · Platform · OpsDesk" }

// The console overview (D2, Task 3). The view model is built here on the server, so only what the page shows reaches the
// client (not the raw seed with its usage points and invoices). The tenants list lives at /platform/tenants.
export default async function Page() {
  const g = await gate("tenants.read", "the platform overview")
  if ("denied" in g) return g.denied
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <OverviewDashboard data={overviewData(seed, org.today, g.op)} today={org.today} tzLabel={org.tzLabel} />
}
