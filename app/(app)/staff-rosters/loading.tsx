import { headers } from "next/headers"

import { StaffRostersSkeleton, gapGroups, getDerivedGaps, getRosters } from "@/features/staff-rosters"
import { PageSkeleton } from "@/features/shell"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

// Async so the skeleton uses the real row count and the role's controls (loading.tsx gets no params).
// loading.tsx gets no search params either: coming back from a gap page (Save, Cancel, back link → ?tab=gaps) is told
// by the referrer, so that return shows the Roster gaps skeleton. Anything else shows the default Attendance tab.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "staff")) return <PageSkeleton />
  const [org, user] = await Promise.all([getMockOrg(), getSkeletonUser()])
  const [{ incidents, gaps }, h] = await Promise.all([getRosters(false, await getDerivedGaps(session, user.name, org.today)), headers()])
  let fromGap = false
  try {
    fromGap = new URL(h.get("referer") ?? "").pathname.startsWith("/staff-rosters/gaps/")
  } catch {
    // no or malformed referrer: default tab
  }
  if (fromGap) return <StaffRostersSkeleton tab="gaps" rows={gaps.length} groups={gapGroups(gaps)} canWrite={canWrite(session, "staff")} />
  return <StaffRostersSkeleton rows={incidents.length} canWrite={canWrite(session, "staff")} />
}
