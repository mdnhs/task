import { DeniedSkeleton, SettingsSkeleton, getPlatformSettings, requireStaff } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

// Same gate, settings and write permission as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await gate("settings.read", "platform settings")
  if ("denied" in g) return <DeniedSkeleton />
  const [settings, org] = await Promise.all([getPlatformSettings(), getOrg()])
  return <SettingsSkeleton settings={settings} today={org.today} tzLabel={org.tzLabel} operator={{ name: g.op.name, role: g.op.role }} canWrite={requireStaff(g.op, "settings.write")} />
}
