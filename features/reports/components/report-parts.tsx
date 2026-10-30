import Link from "next/link"

import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { formatDate } from "@/lib/dates"
import { ITEM_STATUS, REPORT_STATE, extraSections, minutesText, sectionOn, totalMinutes, windowLabel } from "@/lib/shift-report"
import type { ReportState, ShiftReport, TemplateSection } from "../types"

// Pieces shared by the editor and the read-only review, so one skeleton fits both.

export function ReportMeta({ report: r, owner, state, now, tzLabel }: { report: ShiftReport; owner: string; state: ReportState; now: string; tzLabel: string }) {
  return (
    <section className="card" aria-label="Report details">
      <dl className="td-meta">
        <div><dt>Person</dt><dd>{owner}</dd></div>
        <div><dt>Team</dt><dd><span className="dep-tag">{r.team}</span></dd></div>
        <div><dt>Shift</dt><dd>{r.shiftName}, {formatDate(r.date)} <span className="num">{windowLabel(r)}</span></dd></div>
        <div><dt>Status</dt><dd><StatusPill status={REPORT_STATE[state]} /></dd></div>
        <div><dt>Due</dt><dd><When iso={r.due} today={now} tzLabel={tzLabel} /></dd></div>
        <div><dt>Submitted</dt><dd>{r.submittedAt ? <When iso={r.submittedAt} today={now} tzLabel={tzLabel} /> : "Not yet"}</dd></div>
        <div><dt>Time reported</dt><dd className="num">{minutesText(totalMinutes(r))}</dd></div>
        {r.reviewedBy && r.reviewedAt && (
          <div><dt>{r.status === "returned" ? "Returned by" : "Reviewed by"}</dt><dd>{r.reviewedBy} · <When iso={r.reviewedAt} today={now} tzLabel={tzLabel} /></dd></div>
        )}
      </dl>
    </section>
  )
}

export const taskHref = (ref: string) => `/tasks/${encodeURIComponent(ref)}`

/** Read-only task rows. */
export function ItemsView({ report: r, canOpenTasks }: { report: ShiftReport; canOpenTasks: boolean }) {
  return (
    <section className="card" aria-labelledby="sr-items-h">
      <div className="card-head">
        <div>
          <h2 id="sr-items-h">Tasks in the shift</h2>
          <div className="sub">{r.items.length} {r.items.length === 1 ? "task" : "tasks"}</div>
        </div>
      </div>
      {r.items.length === 0 ? (
        <p className="td-muted">No tasks were assigned for this shift.</p>
      ) : (
        <div className="table-wrap">
          <table className="rtable sr-items">
            <thead>
              <tr><th>Task</th><th>Status</th><th>Time</th><th>Note</th></tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.taskRef}>
                  <td data-label="Task">
                    {canOpenTasks ? <Link href={taskHref(i.taskRef)} className="tt rep-link">{i.title}</Link> : <span className="tt">{i.title}</span>}
                    <div className="tm num">{i.taskRef}</div>
                  </td>
                  <td data-label="Status"><StatusPill status={ITEM_STATUS[i.status]} /></td>
                  <td data-label="Time" className="num">{minutesText(i.minutes)}</td>
                  <td data-label="Note" className="sr-note">{i.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const Text = ({ v }: { v: string }) => (v.trim() ? <p className="sr-text">{v}</p> : <p className="td-muted">Nothing entered.</p>)

/** Read-only summary, blockers, unplanned work, attachments and the template's extra sections. */
export function NotesView({ report: r, template }: { report: ShiftReport; template: TemplateSection[] }) {
  return (
    <section className="card sr-notes" aria-label="Shift notes">
      {sectionOn(template, "summary") && (<div><h2 className="td-h">Summary</h2><Text v={r.summary} /></div>)}
      {sectionOn(template, "blockers") && (<div><h2 className="td-h">Blockers</h2><Text v={r.blockers} /></div>)}
      {sectionOn(template, "unplanned") && (
        <div>
          <h2 className="td-h">Unplanned work</h2>
          {r.unplanned.length === 0 ? <p className="td-muted">None.</p> : (
            <ul className="sr-list">{r.unplanned.map((u) => <li key={u.id}><span>{u.text}</span><span className="num">{minutesText(u.minutes)}</span></li>)}</ul>
          )}
        </div>
      )}
      {sectionOn(template, "attachments") && (
        <div>
          <h2 className="td-h">Attachments</h2>
          {r.attachments.length === 0 ? <p className="td-muted">None.</p> : (
            <ul className="sr-list">{r.attachments.map((a) => <li key={a.id}><span>{a.name}</span><span className="num">{a.size}</span></li>)}</ul>
          )}
        </div>
      )}
      {extraSections(template).map((s) => (
        <div key={s.id}>
          <h2 className="td-h">{s.title}</h2>
          <dl className="sr-extra">
            {s.fields.map((f) => (
              <div key={f.id}><dt>{f.label}</dt><dd>{r.extra[`${s.id}.${f.id}`]?.trim() || "—"}</dd></div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}
