"use client"

import Link from "next/link"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { formatTime } from "@/lib/dates"
import { isLateSubmission, sectionProgress } from "../lifecycle"
import { REPORT_STATUS } from "../types"
import type { Report, TemplateSection } from "../types"

// The staff view of today's report: deadline countdown (shared with the dashboard), progress and an Open report button.
export function TodayReportCard({
  report,
  template,
  dept,
  today,
  tzLabel,
  countdown,
  deadline,
  reminders,
}: {
  report?: Report
  template: TemplateSection[]
  dept: string
  today: string
  tzLabel: string
  /** The dashboard's DeadlineCountdown, rendered by the server page: the dashboard barrel also exports server-only api code. */
  countdown: React.ReactNode
  deadline: string
  reminders: string[]
}) {
  const day = today.slice(0, 10)
  const { done, total } = report ? sectionProgress(report, template) : { done: 0, total: 0 }
  const pct = total ? Math.round((done / total) * 100) : 0
  const rem = reminders.map((r) => formatTime(`${day}T${r}:00`)).join(" & ")
  return (
    <div className="card deadline rep-today">
      <h2>Today&apos;s report</h2>
      <div className="big">Due today, {formatTime(`${day}T${deadline}:00`)}</div>
      <div className="tz">{tzLabel} · reminders at {rem}</div>
      {countdown}
      <div className="rep-row">
        <div>
          <span className="dep">{dept}</span>
          <small>
            {report?.submittedAt ? (
              <>
                Submitted <When iso={report.submittedAt} today={today} tzLabel={tzLabel} mode="time" />
                {isLateSubmission(report, deadline) ? " · late" : ""}
              </>
            ) : report ? (
              `${done} of ${total} sections complete`
            ) : (
              "No report started"
            )}
          </small>
          <div suppressHydrationWarning className="progress"><i style={{ width: `${report?.submittedAt ? 100 : pct}%` }} /></div>
        </div>
        <StatusPill status={report ? REPORT_STATUS[report.status] : { tone: "mute", label: "Not started" }} />
      </div>
      {report ? (
        <Link href={`/daily-reports/${report.id}`} className="btn btn-primary">
          <Icon name="report" />
          Open report
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" disabled>
          <Icon name="report" />
          Open report
        </button>
      )}
    </div>
  )
}
