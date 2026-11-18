import { unavailablePlatformPage } from "@/features/platform"
import { PlanNewView, getPlatformSeed, getPlatformSettings, planFormData } from "@/features/platform"
import { getMockOrg } from "@/lib/org"

import { gate } from "../../../gate"
import { Unavailable } from "../../../unavailable"

export const metadata = { title: "New plan · Platform · OpsDesk" }

// New plan (id, name, price, limits, modules). Gated on plans.write (owner, billing).
export default async function Page() {
  const g = await gate("plans.write", "platform plan editing")
  if ("denied" in g) return g.denied
  if (unavailablePlatformPage()) return <Unavailable label="Plans" />
  const [seed, org, settings] = await Promise.all([getPlatformSeed(), getMockOrg(), getPlatformSettings()])
  return <PlanNewView data={planFormData(seed)} operator={{ name: g.op.name, role: g.op.role }} today={org.today} defaultTrialDays={settings.defaultTrialDays} />
}
