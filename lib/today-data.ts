import { cookies } from "next/headers"
import { getData } from "./data"
import type { Org } from "./org"
import { ME_ID, getPeople } from "./people"
import { can, reportScope } from "./permissions"
import { reportState, scopeReports } from "./shift-report"
import { getShiftReportData } from "./shift-reports-data"
import { getShiftState } from "./shifts-data"
import type { Session } from "./session"
import { TODAY_COOKIE_AUTO, TODAY_COOKIE_DISMISSED, teamOverdue, todayMode, workingDay } from "./today"
import type { TeamOverdue, TodayMode, TodayTask, WorkingDay } from "./today"
import { addDays } from "./shifts"
import { activeTasks, isAssignee } from "./task-scope"

// Server only. Builds what the Today card needs, already cut to what the signed-in role may see (FR-M1-80): the person's own
// tasks, and for reviewers the team numbers. Nothing here is sent for roles without the dashboard.

type RawTask = Omit<TodayTask, "evidenceRequired" | "project"> & { assignee: string; assignees?: string[]; archivedAt?: string; client?: string; dept: string; evidenceRule?: { mode: string } }
export type TodayData = {
  meId: string
  /** For the player's task changes (lib/task-inbox.ts hand-off): the tenant and the name on the timeline. */
  tenantId: string
  meName: string
  day: WorkingDay
  /** Tenant now (org.today) the counts and order are computed against. */
  now: string
  tzLabel: string
  mode: TodayMode
  tasks: TodayTask[]
  /** Waiting for me to review; both 0 for people who do not review. */
  review: { evidence: number; reports: number }
  /** Manager version (FR-M1-79); undefined for staff. */
  team?: { overdue: TeamOverdue; missing: { who: string; shift: string }[]; evidence: number }
}

/** The directory person this session acts as: staff roles are "me", other roles their linked person, else the signed-in user's name. */
export function todayUserId(session: Session, people: { id: string; name: string }[], userName?: string): string {
  if (session.role.home === "staff") return ME_ID
  return session.role.person ?? people.find((p) => p.name === userName)?.id ?? ME_ID
}

export async function getTodayData(session: Session, org: Org, userName?: string): Promise<TodayData> {
  const [people, { tasks: seeded }, shifts, jar] = await Promise.all([getPeople(), getData<{ tasks: RawTask[] }>("tasks/tasks.json"), getShiftState(), cookies()])
  // Archived tasks are out of every count (FR-M1-13); "mine" means any assignee, not only the primary one.
  const tasks = activeTasks(seeded)
  const meId = todayUserId(session, people, userName)
  const who = { tenantId: session.tenant.id, meName: people.find((p) => p.id === meId)?.name ?? userName ?? "" }
  const staff = session.role.home === "staff"
  const now = org.today
  const day = workingDay(meId, now, shifts.patterns, shifts.assignments, org.timezone)
  const mode = todayMode(jar.get(TODAY_COOKIE_AUTO)?.value, readCookie(jar.get(TODAY_COOKIE_DISMISSED)?.value), meId, day.key)

  const mine: TodayTask[] = tasks
    .filter((t) => isAssignee(t, meId))
    .map((t) => ({ ref: t.ref, title: t.title, priority: t.priority, due: t.due, status: t.status, evidenceRequired: t.evidenceRule?.mode === "required", project: t.client ?? t.dept }))
  const reviewer = !staff && can(session.role, "tasks")
  const evidence = reviewer ? tasks.filter((t) => !isAssignee(t, meId) && t.status === "submitted").length : 0
  if (staff || !reviewer) return { meId, ...who, day, now, tzLabel: org.tzLabel, mode, tasks: mine, review: { evidence: 0, reports: 0 } }

  // Shift reports (step 2 data): submitted ones wait for review, "missing" ones from the last day are the manager's alert.
  const scope = reportScope(session.role, meId)
  let reports = 0
  let missing: { who: string; shift: string }[] = []
  if (scope) {
    const data = await getShiftReportData(org)
    const rows = scopeReports(data.rows, scope, shifts.members)
    reports = rows.filter((r) => reportState(r, now, org.timezone) === "submitted" || reportState(r, now, org.timezone) === "late").length
    const since = addDays(now.slice(0, 10), -1)
    const name = (id: string) => people.find((p) => p.id === id)?.name ?? id
    missing = rows.filter((r) => r.end.slice(0, 10) >= since && reportState(r, now, org.timezone) === "missing").map((r) => ({ who: name(r.personId), shift: r.shiftName }))
  }
  const named = (id: string) => people.find((p) => p.id === id)?.name ?? id
  const overdue = teamOverdue(tasks.map((t) => ({ ...t, evidenceRequired: t.evidenceRule?.mode === "required", project: t.client ?? t.dept })), meId, now, named)
  return { meId, ...who, day, now, tzLabel: org.tzLabel, mode, tasks: mine, review: { evidence, reports }, team: { overdue, missing, evidence } }
}

// The cookie is written URI-encoded by lib/today-prefs.
function readCookie(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}
