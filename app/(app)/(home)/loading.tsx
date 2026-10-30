import { DashboardSkeleton, StaffDashboardSkeleton, getCoverage, getDashboard, getDashboardPerms, getReportDeadline, getStaffDashboard, getSummary, getTeamTasks } from "@/features/dashboard"
import { PageSkeleton, getUser } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getOrg } from "@/lib/org"
import { getSession } from "@/lib/session"
import { getTodayData } from "@/lib/today-data"

// Async so the skeleton matches the role's home (cookies() is allowed here; it just reads the request).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "dashboard")) return <PageSkeleton />
  if (session.role.home !== "staff") {
    const [{ tasks }, { stats }, { coverage }, org, user, { attention, progress }] = await Promise.all([getTeamTasks(), getSummary(), getCoverage(), getOrg(), getUser(), getDashboard()])
    // The Today card is folded to a compact entry once dismissed; the same cookies decide it here as on the page (needs the real data's shape only).
    const [t, deadline] = await Promise.all([getTodayData(session, org, user.name), getReportDeadline(session, org, user.name)])
    const today = { mode: t.mode, tiles: t.team ? 5 : 4, team: !!t.team, data: t }
    return <DashboardSkeleton today={today} deadline={deadline} perms={getDashboardPerms(session)} teamTasks={tasks} notes={stats.map((s) => s.note)} coverage={coverage} attention={attention} progress={progress} />
  }
  const [{ myTasks, comments, evidence }, org] = await Promise.all([getStaffDashboard(), getOrg()])
  const [t, deadline] = await Promise.all([getTodayData(session, org), getReportDeadline(session, org)])
  return <StaffDashboardSkeleton today={{ mode: t.mode, tiles: 4, team: false, data: t }} deadline={deadline} comments={comments} myTasks={myTasks} evidence={evidence} date={org.today} tzLabel={org.tzLabel} notes={myTasks.stats.map((s) => ({ text: s.note }))} />
}
