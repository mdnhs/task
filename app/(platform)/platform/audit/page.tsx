import { LiveAudit, loadAudit } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Audit log · Platform · OpsDesk" }

// The platform audit log (owner and viewer), the newest 200 entries; the CSV export is the API's stream through the BFF.
export default async function Page() {
  const g = await gate("audit.read", "the platform audit log")
  if ("denied" in g) return g.denied
  const r = await settle(apiServer().then((api) => loadAudit(api, { limit: 200 })))
  return r.ok ? <LiveAudit lines={r.v} /> : refused(r.e, "the platform audit log")
}
