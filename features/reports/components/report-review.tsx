"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { PageHead } from "@/components/page-head"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { apiBrowser } from "@/lib/api/browser"
import { classifyApiError, userMessage } from "@/lib/api/problem"
import { formatDate, formatTime } from "@/lib/dates"
import { canReviewReport, windowLabel } from "@/lib/shift-report"
import { makeReportsClient } from "../client"
import { reportStateAt } from "../time"
import type { ShiftReport, TemplateSection } from "../types"
import { ExportMenu } from "./export-menu"
import type { ReportPageProps } from "./report-page"
import { ItemsView, NotesView, ReportMeta } from "./report-parts"
import { VersionHistory } from "./version-history"

/**
 * Read-only shift report (FR-M1-27/28): the owner after submitting, read-only roles, and managers. A manager with review rights accepts a submitted report or returns it with a comment
 * (FR-M1-29): both send the report's CURRENT version and the comment; the member is told either way. Nobody reviews their own report: the buttons are not shown to the owner, and the API's
 * 403 self_review ("You cannot review your own report") shows if it still happens. A 409 version_conflict reloads the report.
 */
export function ReportReview({
  report: r,
  owner,
  template,
  versions,
  back,
  now,
  nowAt,
  tz,
  tzLabel,
  canReview,
  canOpenTasks,
  meId,
}: ReportPageProps & {
  report: ShiftReport
  owner: string
  template: TemplateSection[]
  back: React.ReactNode
}) {
  const router = useRouter()
  const client = useState(() => makeReportsClient(apiBrowser, tz))[0]
  const [returning, setReturning] = useState(false)
  const state = reportStateAt(r, nowAt)
  const review = canReview && r.personId !== meId && canReviewReport(r)
  const first = owner.split(" ")[0]

  /** Runs one review call; a refusal shows the API's copy and reloads the report when it changed under us. */
  async function run(call: () => Promise<ShiftReport>, ok: () => void): Promise<boolean> {
    try {
      await call()
      ok()
      router.refresh()
      return true
    } catch (e) {
      const k = classifyApiError(e)
      const m = userMessage(e)
      toast.error(m.ref ? `${m.text} (Ref ${m.ref})` : m.text)
      if (k.kind === "version_conflict" || k.code === "report_not_submitted") router.refresh()
      return false
    }
  }
  const accept = () => run(() => client.accept(r), () => toast.success("Report accepted", { description: `${first} has been notified.` }))
  const doReturn = (text: string) =>
    run(() => client.returnIt(r, text), () => toast.success("Report returned", { description: `${first} has been notified and can edit and resubmit it.` }))
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
              <ActionButton className="btn btn-primary rf-btn" onAction={accept}>Accept</ActionButton>
            </>
          )
        }
      />
      {pending && (
        <div className={`td-state ${state === "missing" ? "warn" : "mute"} sr-banner`}>
          <strong>{state === "missing" ? "Missing: not submitted by the due time" : "Not submitted yet"}</strong>
          <span>
            Due <When iso={r.due} today={now} tzLabel={tzLabel} />. The rows below are the tasks in the shift{r.version > 1 ? " with the member's draft so far" : ""}.
          </span>
        </div>
      )}
      <div className="sr-col">
        <ReportMeta report={r} owner={owner} state={state} now={now} tzLabel={tzLabel} />
        <ItemsView report={r} canOpenTasks={canOpenTasks} />
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
        <VersionHistory report={r} versions={versions} today={now} tzLabel={tzLabel} />
        <section className="card rf-tools" aria-label="Print and export">
          <button type="button" className="btn btn-outline rf-btn" onClick={() => window.print()}>Print</button>
          {r.reportId && <ExportMenu className="rf-btn" label="This report" request={{ reportId: r.reportId }} />}
        </section>
      </div>
      <ReturnDialog open={returning} onOpenChange={setReturning} who={first} onReturn={doReturn} />
    </>
  )
}

// FR-M1-29: returning a report needs a comment explaining what to change.
function ReturnDialog({ open, onOpenChange, who, onReturn }: { open: boolean; onOpenChange(o: boolean): void; who: string; onReturn(text: string): Promise<boolean> }) {
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
          onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return setError("Add a comment saying what needs to change")
            if (await onReturn(text.trim())) close(false)
          }}
        >
          <Field label="Comment" htmlFor="sr-return-text" error={error} required>
            <Textarea id="sr-return-text" placeholder="e.g. Add the time spent on each task" value={text} onChange={(e) => { setText(e.target.value); setError("") }} />
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
