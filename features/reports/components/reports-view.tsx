"use client"

import { useMemo } from "react"
import Link from "next/link"

import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { formatDate } from "@/lib/dates"
import { windowLabel, EMPTY_REPORT_FILTERS } from "@/lib/shift-report"
import { currentRowAt, draftPhaseAt, needsActionAt, reportStateAt } from "../time"
import { REPORT_STATE } from "../types"
import type { InboxRow, ReportFilters, ReportsData } from "../types"
import { ReportInbox, rowHref } from "./report-inbox"

/**
 * /daily-reports (FR-M1-22, FR-M1-28). Members (own scope): a prompt for every report that needs them, their current or last shift's report, and their own list. Managers: the inbox for their
 * scope. The scope is the API's: a team manager sees themself and their direct reports, an all-scope manager everyone (F5); the screen never widens it.
 */
export function ReportsView({
  data,
  now,
  nowAt,
  tz,
  tzLabel,
  initialFilters = EMPTY_REPORT_FILTERS,
}: {
  data: ReportsData & { mine?: InboxRow[] }
  /** Tenant wall "now" (date words only). */
  now: string
  /** The same moment as a UTC instant: every comparison reads it (the repeated DST hour, I12). */
  nowAt: string
  tz: string
  tzLabel: string
  initialFilters?: ReportFilters
}) {
  const own = data.scope === "own"
  // The member's prompts come from the UNFILTERED window (the list below may be filtered by the URL).
  const base = data.mine ?? data.rows
  const pending = useMemo(() => (own ? needsActionAt(base, nowAt) : []), [own, base, nowAt])
  const current = useMemo(() => (own ? currentRowAt(base, nowAt) : undefined), [own, base, nowAt])

  return (
    <>
      <PageHead
        title="Shift Reports"
        subtitle={
          own
            ? `Your end-of-shift reports · due ${data.dueAfterMinutes} min after your shift ends`
            : `${data.scope === "team" ? "Your team's" : "Every"} report per person and shift · due ${data.dueAfterMinutes} min after shift end`
        }
      />
      {own && pending.length > 0 && <ReportPrompt rows={pending} meId={data.meId} now={now} nowAt={nowAt} tzLabel={tzLabel} />}
      {own && <MyReportCard row={current} meId={data.meId} now={now} nowAt={nowAt} tzLabel={tzLabel} />}
      <ReportInbox data={data} nowAt={nowAt} today={now} tz={tz} tzLabel={tzLabel} initialFilters={initialFilters} />
    </>
  )
}

/** FR-M1-22: the shift has ended and the report is due (or missing, or was returned). */
function ReportPrompt({ rows, meId, now, nowAt, tzLabel }: { rows: InboxRow[]; meId: string; now: string; nowAt: string; tzLabel: string }) {
  return (
    <section className="card sr-prompt" aria-labelledby="sr-prompt-h">
      <h2 className="td-h" id="sr-prompt-h">
        {rows.length === 1 ? "A shift report needs you" : `${rows.length} shift reports need you`}
      </h2>
      <ul className="sr-prompt-list">
        {rows.map((r) => {
          const s = reportStateAt(r, nowAt)
          return (
            <li key={r.id} data-tone={REPORT_STATE[s].tone}>
              <div className="sr-prompt-main">
                <strong>{r.shiftName}, {formatDate(r.date)}</strong>
                <span>
                  {s === "returned"
                    ? "Returned: your manager asked for changes."
                    : s === "missing"
                      ? <>Missing. It was due <When iso={r.due} today={now} tzLabel={tzLabel} />. Submit it now; it will be marked late.</>
                      : <>Your shift has ended. Due <When iso={r.due} today={now} tzLabel={tzLabel} />.</>}
                </span>
              </div>
              <Link href={rowHref(r, meId) ?? "/daily-reports"} className="btn btn-primary sr-prompt-btn">
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
function MyReportCard({ row: r, meId, now, nowAt, tzLabel }: { row?: InboxRow; meId: string; now: string; nowAt: string; tzLabel: string }) {
  if (!r) {
    return (
      <section className="card sr-mine" aria-labelledby="sr-mine-h">
        <h2 className="td-h" id="sr-mine-h">My shift report</h2>
        <p className="td-muted">You have no shifts with reporting on in the last days.</p>
      </section>
    )
  }
  const s = reportStateAt(r, nowAt)
  const total = r.itemCount
  const pct = total ? Math.round((r.doneCount / total) * 100) : 0
  return (
    <section className="card sr-mine" aria-labelledby="sr-mine-h">
      <div className="card-head">
        <div>
          <h2 id="sr-mine-h">My shift report</h2>
          <div className="sub">
            {r.shiftName} · {formatDate(r.date)} {windowLabel(r)}
            {s === "draft" && draftPhaseAt(r, nowAt) === "in_shift" ? " · in shift now" : ""}
          </div>
        </div>
        <StatusPill status={REPORT_STATE[s]} />
      </div>
      <dl className="td-meta sr-mine-meta">
        <div><dt>Due</dt><dd><When iso={r.due} today={now} tzLabel={tzLabel} /></dd></div>
        <div><dt>Tasks</dt><dd className="num">{total}</dd></div>
      </dl>
      <div className="sr-mine-prog">
        <span className="tm">{r.doneCount} of {total} tasks done</span>
        <div className="progress" role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      </div>
      <Link href={rowHref(r, meId) ?? "/daily-reports"} className="btn btn-primary sr-mine-btn">
        {r.status === "draft" || r.status === "returned" ? "Open my report" : "View my report"}
      </Link>
    </section>
  )
}
