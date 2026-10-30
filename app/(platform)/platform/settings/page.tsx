import { SettingsView, getPlatformSettings, requireStaff } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Settings · Platform · OpsDesk" }

// Platform settings (Task 9, D10). Every staff role can view them (settings.read); only settings.write (owner) can save,
// so other roles get the same form read only and without Save.
export default async function Page() {
  const g = await gate("settings.read", "platform settings")
  if ("denied" in g) return g.denied
  const [settings, org] = await Promise.all([getPlatformSettings(), getOrg()])
  return <SettingsView settings={settings} today={org.today} tzLabel={org.tzLabel} operator={{ name: g.op.name, role: g.op.role }} canWrite={requireStaff(g.op, "settings.write")} />
}
