import { cookies } from "next/headers"

import { Icon } from "@/components/icons"
import { DashboardView, StaffDashboardView, dashboardScreenData, getCoverage, getDashboardPerms, loadManagerHome, loadStaffHome, loadToday } from "@/features/dashboard"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { NewTaskButton } from "@/features/tasks"
import { formatDateYear } from "@/lib/dates"
import { mockEnabled } from "@/lib/mock-registry"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"
import { todaySubject } from "@/lib/today-prefs"
import { todayCookieName } from "@/lib/today"

// The home screen on the API's read models (B6 T6.7, F17, F18): the manager or the staff dashboard, the attention feed and the Today card. The figures are the API's (cached 30 s per user on the
// server). A caller without the dashboard module sees the restricted state; a support session gets 403 on Today and the staff dashboard, shown as the restricted state / no Today card.
function readCookie(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export default async function Page() {
  const session = await requireMfaOk()
  // The platform role has no tenant module access (SRS §3.21), so no tenant data reaches it here.
  if (!can(session.role, "dashboard")) return <AccessRestricted moduleLabel="Dashboard" />
  const loaded = await Promise.all([dashboardScreenData(), getOrg(), cookies()])
    .then(async ([{ api, people }, org, jar]) => {
      const meId = session.user.id
      const subject = todaySubject(session.tenant.slug, meId)
      const cookie = { auto: jar.get(todayCookieName("auto", subject))?.value, dismissed: readCookie(jar.get(todayCookieName("dismissed", subject))?.value) }
      if (session.role.home === "staff") {
        const [home, todayCard] = await Promise.all([loadStaffHome(api, { org }), loadToday(api, { meId, subject, org, cookies: cookie })])
        return { ok: true as const, org, staff: { home, todayCard } }
      }
      const perms = getDashboardPerms(session)
      const [home, todayCard] = await Promise.all([loadManagerHome(api, { org, people, perms, withAttention: can(session.role, "attention") }), loadToday(api, { meId, subject, org, cookies: cookie })])
      return { ok: true as const, org, manager: { home, todayCard, perms } }
    })
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Dashboard")
    if (v) return v
    throw loaded.e
  }
  const { org } = loaded
  if ("staff" in loaded && loaded.staff) {
    const { home, todayCard } = loaded.staff
    return (
      <StaffDashboardView
        header={{ title: "My day", subtitle: `${session.user.name}, ${session.role.label}` }}
        myTasks={home.myTasks}
        evidence={home.evidence}
        comments={home.comments}
        org={org}
        todayCard={todayCard}
        deadline={home.deadline}
      />
    )
  }
  const { home, todayCard, perms } = loaded.manager!
  const demo = mockEnabled()
  return (
    <DashboardView
      header={{ title: "Dashboard", subtitle: `${formatDateYear(org.today)} · ${session.tenant.name}` }}
      data={home}
      teamTasks={home.teamTasks}
      attention={home.attention}
      today={todayCard}
      deadline={home.deadline}
      perms={perms}
      coverage={demo ? await getCoverage() : undefined}
      remind={demo}
      queue={demo}
      clock={{ tz: org.timezone, today: org.today }}
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
