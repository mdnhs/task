// Server-only builder for the in-app reminder context (FR-NOT-02/03). Reads mock JSON; a real build would query the API.
import { getData } from "./data"
import { reminderSchedule, type NotifyContext, type OrgTiming, type TenantNotify, type UserNotifyPrefs } from "./notify"

// Report statuses that still count as "not submitted" for reminders.
const OPEN = new Set(["draft", "returned", "overdue"])

export async function getNotifyContext(org: OrgTiming & { departments: string[] }, role: { id: string }, canSubmit: boolean): Promise<NotifyContext> {
  const [tenant, user, reports] = await Promise.all([
    getData<TenantNotify>("settings/notifications.json"),
    getData<UserNotifyPrefs>("account/notifications.json"),
    getData<{ reports: { date: string; dept: string; status: string }[] }>("reports/reports.json"),
  ])
  const date = org.today.slice(0, 10)
  const pending = org.departments.filter((d) => {
    const r = reports.reports.find((x) => x.date === date && x.dept === d)
    return !r || OPEN.has(r.status)
  })
  return {
    today: org.today,
    deadline: org.deadline,
    schedule: reminderSchedule(org, tenant, user),
    pending,
    canSubmit,
    isManager: tenant.overdueRoles.includes(role.id),
    hideSensitive: tenant.hideSensitive,
  }
}
