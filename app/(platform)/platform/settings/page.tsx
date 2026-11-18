import { LiveSettings, loadSettings, requireStaff } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Settings · Platform · OpsDesk" }

// Platform settings (owner only, like the API's settings routes): email, file storage and billing. The API never returns a secret: only its last 4.
export default async function Page() {
  const g = await gate("settings.read", "platform settings")
  if ("denied" in g) return g.denied
  const r = await settle(apiServer().then((api) => loadSettings(api)))
  return r.ok ? <LiveSettings {...r.v} canWrite={requireStaff(g.op, "settings.write")} /> : refused(r.e, "platform settings")
}
