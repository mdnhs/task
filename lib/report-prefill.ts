// FR-REP-13: suggestions for today's daily report, built from linked records (tasks, rosters, recruitment).
// Pure and server-safe. Features never import each other, so the route loads each source through its feature barrel and passes
// plain rows in here; the structural types below name only the columns this file reads.
import { formatDate } from "./dates"

export type PrefillState = "no_issues" | "details" | "action_required"
export type PrefillEntry = { text: string; cells?: Record<string, string> }
export type PrefillField = {
  state: PrefillState
  entries: PrefillEntry[]
  /** Where the suggestion came from, shown to the owner ("Today's tasks"). */
  source: string
}
/** Keys are report field keys: `<sectionId>.<fieldId>`, as in Report.fields. */
export type Prefill = { sources: string[]; fields: Record<string, PrefillField> }

export type PrefillTask = {
  title: string
  dept: string
  assignee: string
  due: string
  status: string
  overdue?: { reason: string; nextAction: string }
}
export type PrefillIncident = { type: string; staff: string; dept: string; shift: string; cover: string | null; status: string; action: string; reportedAt: string }
export type PrefillGap = { when: string; time: string; site: string; role: string; dept: string; coverage: string }
export type PrefillCandidate = { dept: string; history: { at: string; action: string }[] }

export type PrefillInput = {
  dept: string
  /** Tenant "today" (wall-clock ISO). */
  today: string
  people?: { id: string; name: string }[]
  tasks?: PrefillTask[]
  incidents?: PrefillIncident[]
  gaps?: PrefillGap[]
  candidates?: PrefillCandidate[]
}

const SRC_TASKS = "Today's tasks"
const SRC_ROSTER = "Staff and rosters"
const SRC_RECRUIT = "Recruitment"

const entry = (cells: Record<string, string>): PrefillEntry => ({ text: Object.values(cells).filter(Boolean).join(", "), cells })
const text = (t: string): PrefillEntry => ({ text: t })
const none = (source: string): PrefillField => ({ state: "no_issues", entries: [], source })
const list = (state: PrefillState, entries: PrefillEntry[], source: string): PrefillField => ({ state, entries, source })

export function buildPrefill({ dept, today, people = [], tasks, incidents, gaps, candidates }: PrefillInput): Prefill {
  const day = today.slice(0, 10)
  const fields: Record<string, PrefillField> = {}
  const sources: string[] = []

  if (tasks) {
    const mine = tasks.filter((t) => t.dept === dept)
    // Not finished and due today or earlier: overdue work, or work that should have been done today.
    const open = mine.filter((t) => t.status !== "completed" && t.status !== "cancelled" && t.due.slice(0, 10) <= day)
    const who = new Map(people.map((p) => [p.id, p.name]))
    if (open.length) {
      fields["outstanding.tasks-not-completed"] = list(
        "details",
        open.map((t) => entry({ Task: t.title, Owner: who.get(t.assignee) ?? t.assignee, "Target date": formatDate(t.due) })),
        SRC_TASKS,
      )
      const withReason = open.filter((t) => t.overdue?.reason)
      if (withReason.length) fields["outstanding.reason"] = list("details", withReason.map((t) => text(`${t.title}: ${t.overdue!.reason}`)), SRC_TASKS)
      const withAction = open.filter((t) => t.overdue?.nextAction)
      if (withAction.length) fields["outstanding.action-required"] = list("action_required", withAction.map((t) => text(`${t.title}: ${t.overdue!.nextAction}`)), SRC_TASKS)
    } else {
      fields["outstanding.tasks-not-completed"] = none(SRC_TASKS)
    }
    sources.push(SRC_TASKS)
  }

  if (incidents) {
    const todays = incidents.filter((i) => i.dept === dept && i.reportedAt.slice(0, 10) === day)
    const rows = (type: string) =>
      todays
        .filter((i) => i.type === type)
        .map((i) => entry({ Staff: i.staff, Shift: i.shift, Notes: i.action }))
    const callouts = rows("callout")
    const noShows = rows("noshow")
    fields["staff.call-outs"] = callouts.length ? list("details", callouts, SRC_ROSTER) : none(SRC_ROSTER)
    fields["staff.no-shows"] = noShows.length ? list("details", noShows, SRC_ROSTER) : none(SRC_ROSTER)
    const covers = todays.filter((i) => i.cover)
    if (covers.length) fields["staff.cover-arranged"] = list("details", covers.map((i) => text(`${i.staff} (${i.shift}): ${i.cover} covering`)), SRC_ROSTER)
    const issues = todays.filter((i) => i.type === "staff_issue" && i.status !== "resolved")
    if (issues.length) fields["staff.outstanding-staff-issues"] = list("action_required", issues.map((i) => text(`${i.staff}, ${i.shift}: ${i.action}`)), SRC_ROSTER)
    sources.push(SRC_ROSTER)
  }

  if (gaps) {
    const mine = gaps.filter((g) => g.dept === dept && g.coverage !== "covered")
    const line = (g: PrefillGap) => text(`${g.time} ${g.site}, ${g.role}: ${g.coverage === "uncovered" ? "not covered" : "partly covered"}`)
    const bucket = (when: "today" | "tomorrow" | "next_week", key: string) => {
      const rows = mine.filter((g) => g.when === when)
      fields[key] = rows.length ? list("details", rows.map(line), SRC_ROSTER) : none(SRC_ROSTER)
    }
    bucket("today", "rosters.todays-issues")
    bucket("tomorrow", "rosters.tomorrows-cover")
    bucket("next_week", "rosters.next-weeks-gaps")
    if (!sources.includes(SRC_ROSTER)) sources.push(SRC_ROSTER)
  }

  if (candidates) {
    const events = candidates.filter((c) => c.dept === dept).flatMap((c) => c.history).filter((h) => h.at.slice(0, 10) === day)
    const count = (action: string) => events.filter((h) => h.action === action).length
    const set = (key: string, action: string) => {
      const n = count(action)
      fields[key] = n ? list("details", [text(String(n))], SRC_RECRUIT) : none(SRC_RECRUIT)
    }
    set("recruitment.applications-reviewed", "Moved to Reviewed")
    set("recruitment.candidates-contacted", "Moved to Contacted")
    set("recruitment.interviews-arranged", "Moved to Interview")
    set("recruitment.new-starters", "Moved to New starter")
    sources.push(SRC_RECRUIT)
  }

  return { sources, fields }
}
