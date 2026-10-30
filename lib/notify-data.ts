// Server-only builder for the in-app reminder context (FR-NOT-02/03, FR-M1-30). Reads mock JSON; a real build would query the API.
import { getData } from "./data"
import { formatDate } from "./dates"
import { eventChannels, missingReportAlerts, preview, reminderSchedule, type MissingReport, type NotifyContext, type OrgTiming, type TenantNotify, type UserNotifyPrefs } from "./notify"
import { ME_ID, getPeople } from "./people"
import { reportScope } from "./permissions"
import { managerOf } from "./shifts"
import { reportState } from "./shift-report"
import { getShiftReportData } from "./shift-reports-data"
import type { Role } from "./types"

export async function getNotifyContext(org: OrgTiming & { departments: string[] }, role: Role, canSubmit: boolean, me?: NotifyContext["me"]): Promise<NotifyContext> {
  const [tenant, user, data, people] = await Promise.all([
    getData<TenantNotify>("settings/notifications.json"),
    getData<UserNotifyPrefs>("account/notifications.json"),
    getShiftReportData(org),
    getPeople(),
  ])
  const date = org.today.slice(0, 10)
  const tz = org.timezone
  // Teams that still owe a shift report for a shift that started today (feeds the end-of-day reminders).
  const pending = org.departments.filter((d) => data.rows.some((r) => r.team === d && r.date === date && ["draft", "missing"].includes(reportState(r, org.today, tz))))

  // FR-M1-30: missing reports alert the member and their primary manager. The viewer only gets the ones meant for them:
  // staff = their own, a team-scoped manager = their team's, other managers = all when their role gets overdue alerts.
  const scope = reportScope(role, ME_ID)
  const channels = eventChannels(tenant, tenant.overdueEvent)
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id
  const missing: MissingReport[] = data.rows
    .filter((r) => reportState(r, org.today, tz) === "missing")
    .map((r) => {
      const mgr = managerOf(r.personId, data.shifts.members)
      return { key: r.id, member: { id: r.personId, name: name(r.personId) }, manager: mgr ? { id: mgr, name: name(mgr) } : null, shift: `${r.shiftName}, ${formatDate(r.date)}`, due: r.due }
    })
  const alerts = !scope || !channels.includes("inapp")
    ? []
    : missingReportAlerts(missing, org.today, channels)
        .filter((d) =>
          scope.kind === "own"
            ? d.audience === "submitters" && d.recipients[0]?.id === scope.personId
            : scope.kind === "team"
              ? d.audience === "managers" && d.recipients[0]?.id === scope.managerId
              : d.audience === "managers" && tenant.overdueRoles.includes(role.id),
        )
        .map((d) => ({ id: d.id, title: preview(d.message, tenant.hideSensitive).title, at: `${d.atIso}:00`, href: `/daily-reports/${encodeURIComponent(d.id.split(":").slice(1, 4).join(":"))}` }))

  return {
    today: org.today,
    deadline: org.deadline,
    schedule: reminderSchedule(org, tenant, user),
    pending,
    canSubmit,
    isManager: tenant.overdueRoles.includes(role.id),
    hideSensitive: tenant.hideSensitive,
    alerts,
    me,
  }
}
