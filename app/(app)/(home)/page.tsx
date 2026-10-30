import { Icon } from "@/components/icons"
import { DashboardView, StaffDashboardView, getDashboard, getDashboardPerms, getReportDeadline, getStaffDashboard } from "@/features/dashboard"
import { AccessRestricted, getUser } from "@/features/shell"
import { NewTaskButton } from "@/features/tasks"
import { getOrg } from "@/lib/org"
import { getTodayData } from "@/lib/today-data"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

export default async function Page() {
  const session = await getSession()
  // The platform role has no tenant module access (SRS §3.21), so no tenant data reaches it here.
  if (!can(session.role, "dashboard")) return <AccessRestricted moduleLabel="Dashboard" />
  if (session.role.home === "staff") {
    const [data, org] = await Promise.all([getStaffDashboard(), getOrg()])
    const [todayCard, deadline] = await Promise.all([getTodayData(session, org), getReportDeadline(session, org)])
    return <StaffDashboardView data={data} org={org} todayCard={todayCard} deadline={deadline} />
  }
  const [dashboard, org, user] = await Promise.all([getDashboard(), getOrg(), getUser()])
  const [today, deadline] = await Promise.all([getTodayData(session, org, user.name), getReportDeadline(session, org, user.name)])
  return (
    <DashboardView
      data={dashboard}
      today={today}
      deadline={deadline}
      perms={getDashboardPerms(session)}
      newTask={
        <NewTaskButton className="btn btn-primary" from="/">
          <Icon name="plus" />
          New Task
        </NewTaskButton>
      }
      assignTask={
        <NewTaskButton className="pill-btn" from="/">
          <Icon name="plus" />
          Assign Task
        </NewTaskButton>
      }
    />
  )
}
