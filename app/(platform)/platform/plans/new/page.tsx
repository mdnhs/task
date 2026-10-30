import { PlanNewView, getPlatformSeed, getPlatformSettings, planFormData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../../gate"

export const metadata = { title: "New plan · Platform · OpsDesk" }

// New plan (id, name, price, limits, modules). Gated on plans.write (owner, billing).
export default async function Page() {
  const g = await gate("plans.write", "platform plan editing")
  if ("denied" in g) return g.denied
  const [seed, org, settings] = await Promise.all([getPlatformSeed(), getOrg(), getPlatformSettings()])
  return <PlanNewView data={planFormData(seed)} operator={{ name: g.op.name, role: g.op.role }} today={org.today} defaultTrialDays={settings.defaultTrialDays} />
}
