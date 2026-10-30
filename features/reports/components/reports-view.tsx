"use client"

import { useMemo } from "react"
import Link from "next/link"

import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { formatDate } from "@/lib/dates"
import { currentReport, draftPhase, itemProgress, minutesText, needsAction, reportState, totalMinutes, windowLabel, EMPTY_REPORT_FILTERS } from "@/lib/shift-report"
import type { ExportMeta } from "../export"
import { reportsStore } from "../store"
import { REPORT_STATE } from "../types"
import type { ReportFilters, ReportsSeed, ShiftReport } from "../types"
import { ReportInbox } from "./report-inbox"

const reportHref = (id: string) => `/daily-reports/${encodeURIComponent(id)}`

/**
 * /daily-reports (FR-M1-22, FR-M1-28). Members (own scope): a prompt for every report that needs them, their current or last
 * shift's report, and their own list. Managers: the inbox for their team (team scope) or everyone (all scope).
 */
export function ReportsView({
  seed,
  now,
  tz,
  tzLabel,
  initialFilters = EMPTY_REPORT_FILTERS,
  exportMeta,
}: {
  seed: ReportsSeed
  /** Tenant "now" (org.today, wall clock). */
  now: string
  tz: string
  tzLabel: string
  initialFilters?: ReportFilters
  exportMeta: ExportMeta
}) {
  const [reports] = reportsStore.useStore(seed.reports, seed.scopeKey)
  const own = seed.scope === "own"
  const pending = useMemo(() => (own ? needsAction(reports, seed.meId, now, tz) : []), [own, reports, seed.meId, now, tz])
  const current = useMemo(() => (own ? currentReport(reports, seed.meId, now, tz) : undefined), [own, reports, seed.meId, now, tz])

  return (
    <>
      <PageHead
        title="Shift Reports"
        subtitle={
          own
            ? `Your end-of-shift reports · due ${seed.dueAfterMinutes} min after your shift ends`
            : `${seed.scope === "team" ? "Your team's" : "Every"} report per person and shift · due ${seed.dueAfterMinutes} min after shift end`
        }
      />
      {own && pending.length > 0 && <ReportPrompt reports={pending} now={now} tz={tz} tzLabel={tzLabel} />}
      {own && <MyReportCard report={current} now={now} tz={tz} tzLabel={tzLabel} />}
      <ReportInbox reports={reports} seed={seed} now={now} tz={tz} tzLabel={tzLabel} initialFilters={initialFilters} exportMeta={exportMeta} />
    </>
  )
}

/** FR-M1-22: the shift has ended and the report is due (or missing, or was returned). */
function ReportPrompt({ reports, now, tz, tzLabel }: { reports: ShiftReport[]; now: string; tz: string; tzLabel: string }) {
  return (
    <section className="card sr-prompt" aria-labelledby="sr-prompt-h">
      <h2 className="td-h" id="sr-prompt-h">
        {reports.length === 1 ? "A shift report needs you" : `${reports.length} shift reports need you`}
      </h2>
      <ul className="sr-prompt-list">
        {reports.map((r) => {
          const s = reportState(r, now, tz)
          return (
            <li key={r.id} data-tone={REPORT_STATE[s].tone}>
              <div className="sr-prompt-main">
                <strong>{r.shiftName}, {formatDate(r.date)}</strong>
                <span>
                  {s === "returned"
                    ? `Returned: ${r.comments.at(-1)?.text ?? "your manager asked for changes."}`
                    : s === "missing"
                      ? <>Missing. It was due <When iso={r.due} today={now} tzLabel={tzLabel} />. Submit it now; it will be marked late.</>
                      : <>Your shift has ended. Due <When iso={r.due} today={now} tzLabel={tzLabel} />.</>}
                </span>
              </div>
              <Link href={reportHref(r.id)} className="btn btn-primary sr-prompt-btn">
                {s === "returned" ? "Fix and resubmit" : "Open report"}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** "My shift report": the running shift's report, else the latest one. */
function MyReportCard({ report: r, now, tz, tzLabel }: { report?: ShiftReport; now: string; tz: string; tzLabel: string }) {
  if (!r) {
    return (
      <section className="card sr-mine" aria-labelledby="sr-mine-h">
        <h2 className="td-h" id="sr-mine-h">My shift report</h2>
        <p className="td-muted">You have no shifts with reporting on in the last days.</p>
      </section>
    )
  }
  const s = reportState(r, now, tz)
  const { done, total } = itemProgress(r)
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <section className="card sr-mine" aria-labelledby="sr-mine-h">
      <div className="card-head">
        <div>
          <h2 id="sr-mine-h">My shift report</h2>
          <div className="sub">
            {r.shiftName} · {formatDate(r.date)} {windowLabel(r)}
            {s === "draft" && draftPhase(r, now, tz) === "in_shift" ? " · in shift now" : ""}
          </div>
        </div>
        <StatusPill status={REPORT_STATE[s]} />
      </div>
      <dl className="td-meta sr-mine-meta">
        <div><dt>Due</dt><dd><When iso={r.due} today={now} tzLabel={tzLabel} /></dd></div>
        <div><dt>Tasks</dt><dd className="num">{total}</dd></div>
        <div><dt>Time reported</dt><dd className="num">{minutesText(totalMinutes(r))}</dd></div>
      </dl>
      <div className="sr-mine-prog">
        <span className="tm">{done} of {total} task rows filled in</span>
        <div className="progress" role="progressbar" aria-label="Task rows filled in" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      </div>
      <Link href={reportHref(r.id)} className="btn btn-primary sr-mine-btn">
        {r.status === "draft" || r.status === "returned" ? "Open my report" : "View my report"}
      </Link>
    </section>
  )
}
