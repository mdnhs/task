import { DeniedSkeleton, TeamSkeleton, getStaff, teamData } from "@/features/platform"
import { getOrg } from "@/lib/org"

import { gate } from "../../gate"

// Same gate and view model as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await gate("team.manage", "platform team management")
  if ("denied" in g) return <DeniedSkeleton />
  const [staff, org] = await Promise.all([getStaff(), getOrg()])
  return <TeamSkeleton data={teamData({ operatorId: g.op.id, staff: staff.staff })} today={org.today} tzLabel={org.tzLabel} operator={{ name: g.op.name, role: g.op.role }} />
}
