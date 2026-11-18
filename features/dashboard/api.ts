// Server side of the home screen (B6 T6.7): the manager and staff dashboards, the attention feed and Today are the API's read models for this caller (F17, F18, F21). They are cached per user for 30 s
// on the server, so the numbers may lag the user's own write by up to 30 s: the card refreshes after its own writes and the page tolerates a stale figure. A support session gets 403 on Today and the
// staff dashboard (the page shows the restricted state). Nothing here re-scopes or recounts.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getPeople } from "@/lib/people"
import { canWrite, type Session } from "@/lib/session"
import type { Org } from "@/lib/org"
import type { Person } from "@/lib/types"
import { toAttention, toDashboard, toDeadlineCard, toStaff, toTeamTasks, toToday } from "./adapters"
import type { DashboardPerms, ReportDeadlineCardData, StaffMyTasksData, TodayData } from "./types"
import { todayMode } from "@/lib/today"

type Reader = Pick<ApiClient, "get">

/** The Today read model; a 403 (a support session) is `null` so the card is left out. */
export async function loadToday(api: Reader, o: { meId: string; subject?: string; org: Org; mode?: "all" | "high-and-overdue"; cookies: { auto?: string; dismissed?: string } }): Promise<TodayData | null> {
  const nowAt = o.org.nowAt ?? ""
  try {
    const dto = await api.get("/v1/today", { query: { mode: o.mode ?? "all" } })
    // card or chip at first paint: the two cookies the browser mirrors its choice into, keyed by the SERVER's working day
    const subject = o.subject ?? o.meId
    const card = todayMode(o.cookies.auto, o.cookies.dismissed, subject, dto.workingDay.key)
    return toToday(dto, { meId: o.meId, subject, tz: o.org.timezone, nowAt, now: o.org.today, tzLabel: o.org.tzLabel, mode: card })
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null
    throw e
  }
}

export async function loadManagerHome(api: Reader, o: { org: Org; people: Person[]; perms: DashboardPerms; withAttention: boolean }) {
  const [dto, team, attention] = await Promise.all([
    api.get("/v1/dashboard"),
    api.get("/v1/dashboard/team-tasks", { query: { limit: 25 } }).catch(forbiddenAsNull),
    o.withAttention ? api.get("/v1/attention", { query: { limit: 5 } }).catch(forbiddenAsNull) : Promise.resolve(null),
  ])
  const home = toDashboard(dto, { tz: o.org.timezone, nowAt: o.org.nowAt ?? "", tzLabel: o.org.tzLabel, ...(o.org.reportDueAfterMinutes === undefined ? {} : { dueAfterMinutes: o.org.reportDueAfterMinutes }) })
  return {
    ...home,
    teamTasks: team ? toTeamTasks(team, { people: o.people, tz: o.org.timezone, today: o.org.today }) : null,
    attention: attention ? toAttention(attention) : null,
  }
}

export async function loadStaffHome(api: Reader, o: { org: Org }) {
  const dto = await api.get("/v1/dashboard/staff")
  const home = toStaff(dto, { tz: o.org.timezone })
  const deadline = toDeadlineCard(home.reportDeadline, { tz: o.org.timezone, nowAt: o.org.nowAt ?? "", tzLabel: o.org.tzLabel, ...(o.org.reportDueAfterMinutes === undefined ? {} : { dueAfterMinutes: o.org.reportDueAfterMinutes }) })
  return { ...home, deadline }
}

function forbiddenAsNull(e: unknown): null {
  if (e instanceof ApiError && e.status === 403) return null
  throw e
}

/** Which owner-dashboard actions the session may take (the view reads this). */
export function getDashboardPerms(session: Session): DashboardPerms {
  return { tasks: canWrite(session, "tasks"), reports: canWrite(session, "reports"), attention: canWrite(session, "attention") }
}

export async function dashboardScreenData(): Promise<{ api: ApiClient; people: Person[] }> {
  const [api, people] = await Promise.all([apiServer(), getPeople().catch(() => [] as Person[])])
  return { api, people }
}

export type { ReportDeadlineCardData, StaffMyTasksData }
