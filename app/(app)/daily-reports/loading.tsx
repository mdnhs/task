import { ReportsSkeleton, getReportSeed } from "@/features/reports"
import type { InboxRowSk, OwnReportText } from "@/features/reports"
import { When } from "@/components/when"
import { PageSkeleton } from "@/features/shell"
import { formatDate, formatDue, formatTime } from "@/lib/dates"
import { getOrg } from "@/lib/org"
import { REPORT_STATE, currentReport, draftPhase, isLate, itemProgress, minutesText, needsAction, reportState, totalMinutes, windowLabel } from "@/lib/shift-report"
import { getSession } from "@/lib/session"

// Async so the skeleton matches the scope and uses the real counts from the same seed (loading.tsx gets no search params,
// so the row count is the unfiltered one). The member view gets its real text as ghost text so wrapped lines match on phones.
export default async function Loading() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  const seed = await getReportSeed(session)
  if (!seed) return <PageSkeleton />
  const own = seed.scope === "own"
  const { today: now, timezone: tz, tzLabel } = org
  const needs = own ? needsAction(seed.reports, seed.meId, now, tz) : []
  const cur = own ? currentReport(seed.reports, seed.meId, now, tz) : undefined
  let ownText: OwnReportText | undefined
  if (own) {
    const mine = cur && (() => {
      const s = reportState(cur, now, tz)
      const { done, total } = itemProgress(cur)
      return {
        sub: `${cur.shiftName} \u00b7 ${formatDate(cur.date)} ${windowLabel(cur)}${s === "draft" && draftPhase(cur, now, tz) === "in_shift" ? " \u00b7 in shift now" : ""}`,
        due: formatDue(cur.due, now),
        dueTz: formatDue(cur.due, now).includes(":") ? tzLabel : undefined,
        tasks: total,
        time: minutesText(totalMinutes(cur)),
        progress: `${done} of ${total} task rows filled in`,
        button: cur.status === "draft" || cur.status === "returned" ? "Open my report" : "View my report",
        pill: REPORT_STATE[s].label,
      }
    })()
    ownText = {
      prompts: needs.map((r) => {
        const s = reportState(r, now, tz)
        return {
          title: `${r.shiftName}, ${formatDate(r.date)}`,
          text:
            s === "returned" ? (
              `Returned: ${r.comments.at(-1)?.text ?? "your manager asked for changes."}`
            ) : s === "missing" ? (
              <>Missing. It was due <When iso={r.due} today={now} tzLabel={tzLabel} />. Submit it now; it will be marked late.</>
            ) : (
              <>Your shift has ended. Due <When iso={r.due} today={now} tzLabel={tzLabel} />.</>
            ),
          button: s === "returned" ? "Fix and resubmit" : "Open report",
        }
      }),
      mine,
    }
  }
  const people = new Map(seed.people.map((p) => [p.id, p]))
  const inbox: InboxRowSk[] = seed.reports.slice(0, 10).map((r) => {
    const st = reportState(r, now, tz)
    const p = people.get(r.personId)
    const late = isLate(r, tz)
    return {
      shift: `${formatDate(r.date)} \u00b7 ${r.shiftName}`,
      meta: `${windowLabel(r)} \u00b7 due ${formatTime(r.due)}`,
      person: p && { name: p.name, role: p.role },
      team: r.team,
      status: REPORT_STATE[st].label,
      submitted: r.submittedAt,
      late: late && st !== "late",
      tasks: `${r.items.length} \u00b7 ${minutesText(totalMinutes(r))}`,
    }
  })
  return <ReportsSkeleton own={own} prompts={needs.length} mine={own && !!cur} rows={seed.reports.length} teams={seed.teams.length} ownText={ownText} inbox={inbox} today={now} tzLabel={tzLabel} />
}
