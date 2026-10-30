import { ShiftsSkeleton, getShifts } from "@/features/shifts"
import { PageSkeleton } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { ME_ID } from "@/lib/people"
import { shiftScope } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton uses the role's scope, its controls and the real week grid (loading.tsx gets no params).
export default async function Loading() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  const scope = shiftScope(session.role)
  if (scope === "none") return <PageSkeleton />
  const data = await getShifts(scope, ME_ID)
  return <ShiftsSkeleton data={data} today={org.today} tz={org.timezone} tzLabel={org.tzLabel} canWrite={scope === "all" && canWrite(session, "shifts")} />
}
