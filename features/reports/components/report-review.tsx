"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { flushSync } from "react-dom"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Accordion } from "@/components/ui/accordion"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { formatDate, formatTime, nowInTz } from "@/lib/dates"
import type { Org } from "@/lib/org"
import type { Person } from "@/lib/types"
import type { ExportMeta } from "../export"
import { buildReportDoc } from "../export-rows"
import { reportProgress } from "../lifecycle"
import { REPORT_STATUS } from "../types"
import type { Report, TemplateSection } from "../types"
import { ExportMenu } from "./export-menu"
import { FollowUpDialog } from "./follow-up-dialog"
import { ReportProgress } from "./report-progress"
import { ReportSection } from "./report-section"
import { VersionHistory } from "./version-history"

const noop = () => {}

// Read-only report view (owners after submitting, read-only roles, reviewers). Same head / meta / nil / progress structure
// as the edit form so one loading skeleton fits both. Reviewers can comment per section, accept (FR-REP-09) or return.
export function ReportReview({
  report,
  template,
  owner,
  people,
  org,
  skip,
  canReview,
  canComment,
  me,
  apply,
  back,
  exportMeta,
}: {
  report: Report
  template: TemplateSection[]
  owner: string
  people: Person[]
  org: Org
  /** Accept / Return / follow-up buttons: reviewer role and the report is submitted or resubmitted. */
  canReview: boolean
  canComment: boolean
  /** Restricted sections this role cannot read. */
  skip: string[]
  me: string
  apply(fn: (r: Report) => Report): void
  back: React.ReactNode
  /** Company, date label and brand colour for the export file header. */
  exportMeta: ExportMeta
}) {
  const [open, setOpen] = useState<string[]>([])
  const [returning, setReturning] = useState(false)
  const [followUp, setFollowUp] = useState(false)
  const visible = useMemo(() => template.filter((s) => !skip.includes(s.id)), [template, skip])
  const now = () => nowInTz(org.today, org.timezone)
  const deadlineText = formatTime(`${report.date}T${org.deadline}:00`)
  const title = `${report.dept} report`

  // Print renders every section expanded (the print stylesheet also overrides the panel's hidden state).
  const expandAll = useCallback(() => flushSync(() => setOpen(template.map((s) => s.id))), [template])
  useEffect(() => {
    window.addEventListener("beforeprint", expandAll)
    return () => window.removeEventListener("beforeprint", expandAll)
  }, [expandAll])

  const { done, total } = reportProgress({ ...report, fields: Object.fromEntries(Object.entries(report.fields).filter(([k]) => !skip.includes(k.split(".")[0]))) }, visible)
  const attention = visible.filter((s) =>
    s.fields.some((f) => {
      if (!f.required) return false
      const v = report.fields[`${s.id}.${f.id}`]
      return !v?.state
    }),
  )

  const jump = (sid: string) => {
    setOpen((o) => (o.includes(sid) ? o : [...o, sid]))
    requestAnimationFrame(() => document.getElementById(`sec-${sid}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }))
  }

  const accept = () => {
    const at = now()
    apply((r) => ({ ...r, status: "reviewed", reviewedBy: me, reviewedAt: at, updatedAt: at }))
    toast.success(`Report accepted ${formatTime(at)} ${org.tzLabel}`)
  }
  const returnReport = (text: string) => {
    const at = now()
    apply((r) => ({ ...r, status: "returned", updatedAt: at, comments: [...r.comments, { at, by: me, text }] }))
    toast.success("Report returned for correction")
  }
  const addComment = (section: string, text: string) => {
    const at = now()
    apply((r) => ({ ...r, updatedAt: at, comments: [...r.comments, { at, by: me, text, section }] }))
  }
  const general = report.comments.filter((c) => !c.section)

  return (
    <>
      {back}
      <PageHead
        title={title}
        subtitle={`${formatDate(report.date)} · due ${deadlineText} ${org.tzLabel}`}
        actions={
          canReview && (
            <>
              <button type="button" className="btn btn-outline rf-btn" onClick={() => setReturning(true)}>
                Return for correction
              </button>
              <ActionButton className="btn btn-primary rf-btn" onDone={accept}>
                Accept
              </ActionButton>
            </>
          )
        }
      />
      <div className="rf-grid">
        <div className="rf-col">
          <section className="card rf-meta" aria-label="Report details">
            <dl className="td-meta">
              <div><dt>Date</dt><dd>{formatDate(report.date)}</dd></div>
              <div><dt>Department</dt><dd>{report.dept}</dd></div>
              <div><dt>Owner</dt><dd>{owner}</dd></div>
              <div><dt>Status</dt><dd><StatusPill status={REPORT_STATUS[report.status]} /></dd></div>
              <div><dt>Created</dt><dd><When iso={report.createdAt} today={org.today} tzLabel={org.tzLabel} /></dd></div>
              <div><dt>Last updated</dt><dd><When iso={report.updatedAt} today={org.today} tzLabel={org.tzLabel} /></dd></div>
              <div><dt>Submitted</dt><dd>{report.submittedAt ? <When iso={report.submittedAt} today={org.today} tzLabel={org.tzLabel} /> : "Not yet"}</dd></div>
              <div><dt>Deadline</dt><dd>{deadlineText} {org.tzLabel}</dd></div>
              {report.reviewedAt && (
                <div><dt>Reviewed</dt><dd>{report.reviewedBy} · <When iso={report.reviewedAt} today={org.today} tzLabel={org.tzLabel} /></dd></div>
              )}
            </dl>
          </section>
          <section className="card rf-nil">
            <div>
              <h2 className="td-h" id="rf-nil-h">Nil / clear report</h2>
              <p className="td-muted">Nothing to report today. Marks every field as No issues.</p>
            </div>
            <Switch aria-labelledby="rf-nil-h" checked={report.nil} disabled />
          </section>
          <Accordion multiple className="rf-secs" value={open} onValueChange={(v) => setOpen(v as string[])}>
            {template.map((s) => (
              <ReportSection
                key={s.id}
                section={s}
                report={report}
                errors={{}}
                restricted={skip.includes(s.id)}
                readOnly
                onField={noop}
                extra={<SectionComments sid={s.id} title={s.title} comments={report.comments.filter((c) => c.section === s.id)} canComment={canComment} org={org} onAdd={addComment} />}
              />
            ))}
          </Accordion>
          {general.length > 0 && (
            <section className="card" aria-labelledby="rf-notes-h">
              <h2 className="td-h" id="rf-notes-h">Review notes</h2>
              <ul className="rf-comments">
                {general.map((c, i) => (
                  <li key={i}>
                    <span className="rf-cm-by">{c.by} · <When iso={c.at} today={org.today} tzLabel={org.tzLabel} /></span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <VersionHistory report={report} today={org.today} tzLabel={org.tzLabel} />
          <section className="card rf-tools" aria-label="Print and export">
            <button type="button" className="btn btn-outline rf-btn" onClick={() => { expandAll(); window.print() }}>
              Print
            </button>
            <ExportMenu
              className="rf-btn"
              groups={[{ key: "report", label: "This report", doc: buildReportDoc({ report, template, owner, skip, deadline: org.deadline, tzLabel: org.tzLabel }) }]}
              meta={exportMeta}
            />
            {canComment && (
              <button type="button" className="btn btn-outline rf-btn" onClick={() => setFollowUp(true)}>
                Assign follow-up task
              </button>
            )}
          </section>
        </div>
        <ReportProgress done={done} total={total} attention={attention} onJump={jump} />
      </div>
      <ReturnDialog open={returning} onOpenChange={setReturning} onReturn={returnReport} />
      <FollowUpDialog open={followUp} onOpenChange={setFollowUp} people={people} today={org.today} reportTitle={`${title}, ${formatDate(report.date)}`} />
    </>
  )
}

function SectionComments({
  sid,
  title,
  comments,
  canComment,
  org,
  onAdd,
}: {
  sid: string
  title: string
  comments: Report["comments"]
  canComment: boolean
  org: Org
  onAdd(section: string, text: string): void
}) {
  const [text, setText] = useState("")
  if (!canComment && comments.length === 0) return null
  const id = `rf-cm-${sid}`
  return (
    <div className="rf-cm">
      <h3>Comments</h3>
      {comments.length > 0 && (
        <ul className="rf-comments">
          {comments.map((c, i) => (
            <li key={i}>
              <span className="rf-cm-by">{c.by} · <When iso={c.at} today={org.today} tzLabel={org.tzLabel} /></span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form
          className="rf-cm-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            onAdd(sid, text.trim())
            setText("")
          }}
        >
          <Textarea id={id} aria-label={`Comment on ${title}`} placeholder="Add a comment" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-outline rf-btn" disabled={!text.trim()}>
            Add comment
          </button>
        </form>
      )}
    </div>
  )
}

// FR-REP-09: returning a report needs a comment explaining what to fix.
function ReturnDialog({ open, onOpenChange, onReturn }: { open: boolean; onOpenChange(o: boolean): void; onReturn(text: string): void }) {
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
          <DialogTitle>Return for correction</DialogTitle>
          <DialogDescription>The owner will see your comment and can edit and resubmit the report.</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return setError("Explain what needs to be corrected")
            onReturn(text.trim())
            close(false)
          }}
        >
          <Field label="Comment" htmlFor="rf-return-text" error={error} required>
            <Textarea
              id="rf-return-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setError("")
              }}
            />
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
