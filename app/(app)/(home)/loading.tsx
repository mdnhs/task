import { DashboardSkeleton, StaffDashboardSkeleton, getCoverage, getDashboardPerms, getStaffDashboard, getSummary, getTeamTasks } from "@/features/dashboard"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

// Async so the skeleton matches the role's home (cookies() is allowed here; it just reads the request).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "dashboard")) return <PageSkeleton />
  if (session.role.home !== "staff") {
    const [{ tasks }, { stats }, { coverage }] = await Promise.all([getTeamTasks(), getSummary(), getCoverage()])
    return <DashboardSkeleton perms={getDashboardPerms(session)} teamTasks={tasks} notes={stats.map((s) => s.note)} coverage={coverage} />
  }
  const { report, myTasks } = await getStaffDashboard()
  return <StaffDashboardSkeleton reportOwner={report.owner} notes={myTasks.stats.map((s) => ({ text: s.note }))} />
}
