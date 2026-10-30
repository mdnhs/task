import { headers } from "next/headers"

import { StaffRostersSkeleton, gapGroups, getRosters } from "@/features/staff-rosters"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton uses the real row count and the role's controls (loading.tsx gets no params).
// loading.tsx gets no search params either: coming back from a gap page (Save, Cancel, back link → ?tab=gaps) is told
// by the referrer, so that return shows the Roster gaps skeleton. Anything else shows the default Attendance tab.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "staff")) return <PageSkeleton />
  const [{ incidents, gaps }, h] = await Promise.all([getRosters(false), headers()])
  let fromGap = false
  try {
    fromGap = new URL(h.get("referer") ?? "").pathname.startsWith("/staff-rosters/gaps/")
  } catch {
    // no or malformed referrer: default tab
  }
  if (fromGap) return <StaffRostersSkeleton tab="gaps" rows={gaps.length} groups={gapGroups(gaps)} canWrite={canWrite(session, "staff")} />
  return <StaffRostersSkeleton rows={incidents.length} canWrite={canWrite(session, "staff")} />
}
