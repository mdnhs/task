import { unavailablePlatformPage } from "@/features/platform"
import { PlansView, getPlatformSeed, plansData } from "@/features/platform"
import { getMockOrg } from "@/lib/org"

import { gate } from "../../gate"
import { Unavailable } from "../../unavailable"

export const metadata = { title: "Plans · Platform · OpsDesk" }

// The plans comparison. The view model is built here on the server (plans.ts): tenants as { id, plan, status } only, no
// MRR figures for a staff role without billing.read, no write buttons without plans.write.
export default async function Page() {
  const g = await gate("billing.read", "platform plans")
  if ("denied" in g) return g.denied
  if (unavailablePlatformPage()) return <Unavailable label="Plans" />
  const [seed, org] = await Promise.all([getPlatformSeed(), getMockOrg()])
  return <PlansView data={plansData(seed, g.op)} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
