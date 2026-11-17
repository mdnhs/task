import { DeniedSkeleton, TeamSkeleton, getStaff, teamData } from "@/features/platform"
import { getMockOrg } from "@/lib/org"

import { skeletonGate } from "../../skeleton-gate"

// Same gate and view model as the page, rendered masked: identical layout.
export default async function Loading() {
  const g = await skeletonGate("team.manage", "platform team management")
  if ("denied" in g) return <DeniedSkeleton />
  const [staff, org] = await Promise.all([getStaff(), getMockOrg()])
  return <TeamSkeleton data={teamData({ operatorId: g.op.id, staff: staff.staff })} today={org.today} tzLabel={org.tzLabel} operator={{ name: g.op.name, role: g.op.role }} />
}
