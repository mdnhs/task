import { LiveDataRequests, loadDataRequests, requireStaff } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Data requests · Platform · OpsDesk" }

// GDPR requests across tenants (every staff role reads; no subject identity). Owner and support resolve a running or failed one (B8 T17/T24).
export default async function Page() {
  const g = await gate("data.requests", "platform data requests")
  if ("denied" in g) return g.denied
  const r = await settle(apiServer({ tenant: null }).then((api) => loadDataRequests(api)))
  return r.ok ? <LiveDataRequests data={r.v} canResolve={requireStaff(g.op, "data.resolve")} /> : refused(r.e, "platform data requests")
}
