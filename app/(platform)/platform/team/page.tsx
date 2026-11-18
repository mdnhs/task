import { LiveTeam, loadStaff } from "@/features/platform"
import { apiServer } from "@/lib/api/server"

import { gate } from "../../gate"
import { refused, settle } from "../../settle"

export const metadata = { title: "Team · Platform · OpsDesk" }

// Platform staff (owner only): roles, two-step verification, add and suspend. The API refuses demoting or suspending the last active owner.
export default async function Page() {
  const g = await gate("team.manage", "platform team management")
  if ("denied" in g) return g.denied
  const r = await settle(apiServer({ tenant: null }).then((api) => loadStaff(api)))
  return r.ok ? <LiveTeam staff={r.v} meId={g.op.id} /> : refused(r.e, "platform team management")
}
