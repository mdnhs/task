"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { PageHead } from "@/components/page-head"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { formatDate, formatTime } from "@/lib/dates"
import { acceptReport, canReviewReport, extraSections, returnReport, windowLabel } from "@/lib/shift-report"
import { buildReportDoc } from "../export-rows"
import type { ReportState, ShiftReport, TemplateSection } from "../types"
import { ExportMenu } from "./export-menu"
import type { ReportPageProps } from "./report-page"
import { ItemsView, NotesView, ReportMeta } from "./report-parts"
import { VersionHistory } from "./version-history"

/**
 * Read-only shift report (FR-M1-27/28): the owner after submitting, read-only roles, and managers. A manager with review
 * rights accepts a submitted report or returns it with a comment (FR-M1-29); the member is told either way.
 */
export function ReportReview({
  report: r,
  owner,
  template,
  state,
  apply,
  back,
  now,
  tz,
  tzLabel,
  canReview,
  me,
  exportMeta,
  seed,
}: ReportPageProps & {
  report: ShiftReport
  owner: string
  template: TemplateSection[]
  state: ReportState
  apply(fn: (r: ShiftReport) => ShiftReport): void
  back: React.ReactNode
}) {
  const [returning, setReturning] = useState(false)
  const review = canReview && seed.scope !== "own" && canReviewReport(r)
  const first = owner.split(" ")[0]
  const accept = () => {
    apply((x) => acceptReport(x, now.slice(0, 16), me))
    toast.success("Report accepted", { description: `${first} has been notified.` })
  }
  const doReturn = (text: string) => {
    apply((x) => returnReport(x, now.slice(0, 16), me, text))
    toast.success("Report returned", { description: `${first} has been notified and can edit and resubmit it.` })
  }
  const extraLabels = Object.fromEntries(extraSections(template).flatMap((s) => s.fields.map((f) => [`${s.id}.${f.id}`, f.label])))
  const pending = r.status === "draft"

  return (
    <>
      {back}
      <PageHead
        title={`${r.shiftName} report`}
        subtitle={`${owner} · ${formatDate(r.date)} ${windowLabel(r)} · due ${formatTime(r.due)} ${tzLabel}`}
        actions={
          review && (
            <>
              <button type="button" className="btn btn-outline rf-btn" onClick={() => setReturning(true)}>Return with comment</button>
              <ActionButton className="btn btn-primary rf-btn" onDone={accept}>Accept</ActionButton>
            </>
          )
        }
      />
      {pending && (
        <div className={`td-state ${state === "missing" ? "warn" : "mute"} sr-banner`}>
          <strong>{state === "missing" ? "Missing: not submitted by the due time" : "Not submitted yet"}</strong>
          <span>
            Due <When iso={r.due} today={now} tzLabel={tzLabel} />. The rows below are the tasks in the shift
            {r.updatedAt > r.createdAt ? " with the member's draft so far" : ""}.
          </span>
        </div>
      )}
      <div className="sr-col">
        <ReportMeta report={r} owner={owner} state={state} now={now} tzLabel={tzLabel} />
        <ItemsView report={r} canOpenTasks={seed.scope !== "own" || r.personId === seed.meId} />
        <NotesView report={r} template={template} />
        {r.comments.length > 0 && (
          <section className="card" aria-labelledby="sr-notes-h">
            <h2 className="td-h" id="sr-notes-h">Review comments</h2>
            <ul className="rf-comments">
              {r.comments.map((c, i) => (
                <li key={i}>
                  <span className="rf-cm-by">{c.by} · <When iso={c.at} today={now} tzLabel={tzLabel} /></span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <VersionHistory report={r} today={now} tzLabel={tzLabel} />
        <section className="card rf-tools" aria-label="Print and export">
          <button type="button" className="btn btn-outline rf-btn" onClick={() => window.print()}>Print</button>
          <ExportMenu
            className="rf-btn"
            groups={[{ key: "report", label: "This report", doc: buildReportDoc({ report: r, owner, state, tz, tzLabel, extraLabels }) }]}
            meta={exportMeta}
          />
        </section>
      </div>
      <ReturnDialog open={returning} onOpenChange={setReturning} who={first} onReturn={doReturn} />
    </>
  )
}

// FR-M1-29: returning a report needs a comment explaining what to change.
function ReturnDialog({ open, onOpenChange, who, onReturn }: { open: boolean; onOpenChange(o: boolean): void; who: string; onReturn(text: string): void }) {
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setText("")
      setError("")
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Return with comment</DialogTitle>
          <DialogDescription>{who} will see your comment and can edit and resubmit the report.</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return setError("Say what needs to change")
            onReturn(text.trim())
            close(false)
          }}
        >
          <Field label="Comment" htmlFor="sr-return-text" error={error} required>
            <Textarea id="sr-return-text" value={text} onChange={(e) => { setText(e.target.value); setError("") }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Return report</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
