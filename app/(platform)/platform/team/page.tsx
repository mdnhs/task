import { TeamView, getStaff, teamData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

export const metadata = { title: "Team · Platform · OpsDesk" }

// Platform staff (Task 9): roles, two-step verification, last sign-in, invite, role change and disable. Gated on
// team.manage (owner only); the sidebar and search hide the link for everyone else.
export default async function Page() {
  const g = await gate("team.manage", "platform team management")
  if ("denied" in g) return g.denied
  const [staff, org] = await Promise.all([getStaff(), getOrg()])
  return <TeamView data={teamData({ operatorId: g.op.id, staff: staff.staff })} today={org.today} tzLabel={org.tzLabel} operator={{ name: g.op.name, role: g.op.role }} />
}
