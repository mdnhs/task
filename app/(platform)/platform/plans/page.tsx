import { PlansView, getPlatformSeed, plansData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Plans · Platform · OpsDesk" }

// The plans comparison. The view model is built here on the server (plans.ts): tenants as { id, plan, status } only, no
// MRR figures for a staff role without billing.read, no write buttons without plans.write.
export default async function Page() {
  const g = await gate("billing.read", "platform plans")
  if ("denied" in g) return g.denied
  const [seed, org] = await Promise.all([getPlatformSeed(), getOrg()])
  return <PlansView data={plansData(seed, g.op)} today={org.today} operator={{ name: g.op.name, role: g.op.role }} />
}
