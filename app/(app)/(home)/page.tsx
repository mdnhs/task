import { Icon } from "@/components/icons"
import { DashboardView, StaffDashboardView, getDashboard, getDashboardPerms, getStaffDashboard } from "@/features/dashboard"
import { AccessRestricted, getUser } from "@/features/shell"
import { NewTaskButton, getTaskSeed, taskCreator } from "@/features/tasks"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

export default async function Page() {
  const session = await getSession()
  // The platform role has no tenant module access (SRS §3.21), so no tenant data reaches it here.
  if (!can(session.role, "dashboard")) return <AccessRestricted moduleLabel="Dashboard" />
  if (session.role.home === "staff") {
    const [data, org] = await Promise.all([getStaffDashboard(), getOrg()])
    return <StaffDashboardView data={data} org={org} />
  }
  const [dashboard, org, user, tasks] = await Promise.all([getDashboard(), getOrg(), getUser(), getTaskSeed(session)])
  // Same seed + scope as /tasks, so the task created here is there when the dialog redirects to /tasks/[ref].
  const create = {
    seed: tasks.seed,
    scopeKey: tasks.scopeKey,
    people: tasks.people,
    departments: org.departments,
    defaultDept: org.departments[0] ?? "",
    creator: taskCreator(tasks.people, tasks.staff, user.name),
    today: org.today,
    refFloor: tasks.refFloor,
  }
  return (
    <DashboardView
      data={dashboard}
      perms={getDashboardPerms(session)}
      newTask={
        <NewTaskButton className="btn btn-primary" {...create}>
          <Icon name="plus" />
          New Task
        </NewTaskButton>
      }
      assignTask={
        <NewTaskButton className="pill-btn" {...create}>
          <Icon name="plus" />
          Assign Task
        </NewTaskButton>
      }
    />
  )
}
