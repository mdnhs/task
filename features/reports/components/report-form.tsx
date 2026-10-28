"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Accordion } from "@/components/ui/accordion"
import { Switch } from "@/components/ui/switch"
import { When } from "@/components/when"
import { formatDate, formatTime, nowInTz } from "@/lib/dates"
import type { Org } from "@/lib/org"
import type { Person } from "@/lib/types"
import type { ExportMeta } from "../export"
import type { Prefill } from "@/lib/report-prefill"
import { validateReport, reportProgress } from "../lifecycle"
import { reportsStore } from "../store"
import { REPORT_STATUS } from "../types"
import type { Report, ReportField, TemplateSection } from "../types"
import { ReportProgress } from "./report-progress"
import { ReportReview } from "./report-review"
import { ReportSection } from "./report-section"

const blank = (e: { text: string; cells?: Record<string, string> }) => !e.text.trim() && !Object.values(e.cells ?? {}).some((c) => c.trim())

export function ReportForm({
  id,
  seed,
  scopeKey,
  template,
  people,
  org,
  canEdit,
  canReview,
  meId,
  canPayroll,
  me,
  exportMeta,
  prefill,
}: {
  id: string
  /** Same seed + scopeKey as /daily-reports, so drafts persist across pages. */
  seed: Report[]
  scopeKey: string
  template: TemplateSection[]
  people: Person[]
  org: Org
  /** Role may write reports (and the tenant is not suspended). Edit mode additionally needs ownership and a draft/returned status. */
  canEdit: boolean
  /** Role may review reports (accept, return, comment, assign follow-ups): a manager-home role with write access. */
  canReview: boolean
  /** The signed-in report owner id (mock "me"); edit mode is owner-only. */
  meId: string
  /** Role may read payroll. When false the restricted section is shown as locked and skipped by validation. */
  canPayroll: boolean
  /** Name written on version entries. */
  me: string
  /** Company, date label and brand colour for export file headers (FR-REP-12). */
  exportMeta: ExportMeta
  /** Suggestions from linked records (FR-REP-13), built by the route. Never applied without the owner's click. */
  prefill?: Prefill
}) {
  const router = useRouter()
  const [reports, setReports] = reportsStore.useStore(seed, scopeKey)
  const report = reports.find((r) => r.id === id)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState(false)
  const [open, setOpen] = useState<string[]>([])
  const [confirmNil, setConfirmNil] = useState(false)
  // Field key -> source name, for fields filled from suggestions and not edited since (FR-REP-13).
  const [prefilled, setPrefilled] = useState<Record<string, string>>({})
  const summaryRef = useRef<HTMLDivElement>(null)

  const skip = useMemo(() => (canPayroll ? [] : template.filter((s) => s.restricted).map((s) => s.id)), [canPayroll, template])
  const visible = useMemo(() => template.filter((s) => !skip.includes(s.id)), [template, skip])
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  const apply = useCallback((fn: (r: Report) => Report) => setReports((prev) => prev.map((r) => (r.id === id ? fn(r) : r))), [setReports, id])

  useEffect(() => {
    if (summary) summaryRef.current?.focus()
  }, [summary])

  if (!report) {
    return (
      <div className="card">
        <EmptyState
          icon="report"
          title="Report not found"
          text={`There is no report ${id} that you can open.`}
          action={<Link href="/daily-reports" className="btn btn-outline">Back to daily reports</Link>}
        />
      </div>
    )
  }

  const owner = byId.get(report.owner)
  const back = (
    <Link href="/daily-reports" className="td-back">
      ← Daily reports
    </Link>
  )
  const deadlineText = formatTime(`${report.date}T${org.deadline}:00`)

  // Derived from the store, not the server seed: a report submitted in this session becomes read-only straight away (FR-REP-08).
  const mode = canEdit && report.owner === meId && (report.status === "draft" || report.status === "returned") ? "edit" : "review"
  if (mode === "review") {
    return (
      <ReportReview
        report={report}
        template={template}
        owner={owner?.name ?? report.owner}
        people={people}
        org={org}
        skip={skip}
        canReview={canReview && (report.status === "submitted" || report.status === "resubmitted")}
        canComment={canReview && report.status !== "draft"}
        me={me}
        apply={apply}
        back={back}
        exportMeta={exportMeta}
      />
    )
  }

  const { done, total } = reportProgress({ ...report, fields: Object.fromEntries(Object.entries(report.fields).filter(([k]) => !skip.includes(k.split(".")[0]))) }, visible)
  const incomplete = (s: TemplateSection) =>
    s.fields.some((f) => {
      if (!f.required) return false
      const v = report.fields[`${s.id}.${f.id}`]
      return !v?.state || ((v.state === "details" || v.state === "action_required") && v.entries.every(blank))
    })
  const attention = visible.filter(incomplete)

  const setField = (key: string, next: ReportField) => {
    setPrefilled((p) => {
      if (!(key in p)) return p
      const rest = { ...p }
      delete rest[key]
      return rest
    })
    setErrors((e) => {
      if (!e[key]) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
    apply((r) => {
      // BR-04: choosing a state that is not "no issues / n/a" ends the nil report.
      const nil = r.nil && (next.state === "no_issues" || next.state === "na")
      return { ...r, nil, fields: { ...r.fields, [key]: next }, updatedAt: nowInTz(org.today, org.timezone) }
    })
  }

  const setNil = () =>
    apply((r) => {
      const fields = { ...r.fields }
      for (const s of visible) for (const f of s.fields) fields[`${s.id}.${f.id}`] = { state: "no_issues", entries: [] }
      return { ...r, nil: true, fields, updatedAt: nowInTz(org.today, org.timezone) }
    })

  // Suggestions only for visible fields the owner has not answered yet; they never overwrite anything.
  const pendingKeys = prefill
    ? Object.keys(prefill.fields).filter((k) => visible.some((s) => s.id === k.split(".")[0]) && !report.fields[k]?.state)
    : []
  const usePrefill = () => {
    if (!prefill) return
    const stamp = Date.now().toString(36)
    apply((r) => {
      const fields = { ...r.fields }
      for (const k of pendingKeys) {
        const f = prefill.fields[k]
        fields[k] = { state: f.state, entries: f.entries.map((e, i) => ({ id: `${k}-pf-${stamp}-${i}`, text: e.text, ...(e.cells ? { cells: e.cells } : {}) })) }
      }
      return { ...r, nil: false, fields, updatedAt: nowInTz(org.today, org.timezone) }
    })
    setPrefilled((p) => ({ ...p, ...Object.fromEntries(pendingKeys.map((k) => [k, prefill.fields[k].source])) }))
    toast.success(`${pendingKeys.length} ${pendingKeys.length === 1 ? "field" : "fields"} pre-filled. Review them before you submit.`)
  }
  const prefilledCount = Object.keys(prefilled).length

  const saveDraft = () => {
    apply((r) => ({ ...r, updatedAt: nowInTz(org.today, org.timezone) }))
    toast.success("Draft saved")
  }

  const jump = (sid: string) => {
    setOpen((o) => (o.includes(sid) ? o : [...o, sid]))
    requestAnimationFrame(() => {
      const el = document.getElementById(`sec-${sid}`)
      el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      el?.querySelector<HTMLElement>('[data-slot="accordion-trigger"]')?.focus({ preventScroll: true })
    })
  }

  const submit = () => {
    const at = nowInTz(org.today, org.timezone)
    // Blank entries do not count as entries (validation looks at the entry count).
    const fields = Object.fromEntries(Object.entries(report.fields).map(([k, v]) => [k, { ...v, entries: v.entries.filter((e) => !blank(e)) }]))
    const next: Report = { ...report, fields }
    const errs = validateReport(next, template, skip)
    if (errs.length) {
      apply((r) => ({ ...r, updatedAt: at })) // keep the user's blank rows; only validation sees them filtered
      setErrors(Object.fromEntries(errs.map((e) => [e.key, e.message])))
      setOpen((o) => [...new Set([...o, ...errs.map((e) => e.section)])])
      setSummary(true)
      return false // ActionButton: not submitted, no ✓
    }
    const resub = report.status === "returned"
    apply(() => ({
      ...next,
      status: resub ? "resubmitted" : "submitted",
      submittedAt: report.submittedAt ?? at,
      updatedAt: at,
      versions: [...report.versions, { v: report.versions.length + 1, at, by: me, note: resub ? "Resubmitted" : "Submitted" }],
    }))
    setErrors({})
    setSummary(false)
    toast.success(`Report ${resub ? "resubmitted" : "submitted"} ${formatTime(at)} ${org.tzLabel}`)
    router.push("/daily-reports")
  }

  const errorCount = Object.keys(errors).length
  const errSections = new Set(Object.keys(errors).map((k) => k.split(".")[0]))
  const returnedNote = report.status === "returned" ? [...report.comments].reverse()[0] : undefined

  return (
    <>
      {back}
      <PageHead
        title={`${report.dept} report`}
        subtitle={`${formatDate(report.date)} · due ${deadlineText} ${org.tzLabel}`}
        actions={
          <>
            <ActionButton className="btn btn-outline rf-btn" onAction={saveDraft}>
              Save draft
            </ActionButton>
            <ActionButton className="btn btn-primary rf-btn" onAction={submit}>
              {report.status === "returned" ? "Resubmit" : "Submit"}
            </ActionButton>
          </>
        }
      />
      {summary && errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rf-summary">
          <strong>
            {errorCount} {errorCount === 1 ? "field needs" : "fields need"} attention before you can submit
          </strong>
          <span className="rf-summary-links">
            {template.filter((s) => errSections.has(s.id)).map((s) => (
              <button key={s.id} type="button" onClick={() => jump(s.id)}>
                {s.n}. {s.title}
              </button>
            ))}
          </span>
        </div>
      )}
      {returnedNote && (
        <div className="td-state warn">
          <strong>Returned for correction</strong>
          <span>{returnedNote.text}</span>
        </div>
      )}
      {(pendingKeys.length > 0 || prefilledCount > 0) && prefill && (
        <section className="card rf-prefill-bar" aria-label="Suggested answers">
          {pendingKeys.length > 0 ? (
            <>
              <p>
                <strong>Fill from linked records</strong>
                {pendingKeys.length} {pendingKeys.length === 1 ? "field has" : "fields have"} a suggestion from {prefill.sources.join(", ").toLowerCase()}. Nothing is saved or submitted until you review it.
              </p>
              <button type="button" className="btn btn-outline rf-btn" onClick={usePrefill}>
                Use suggestions
              </button>
            </>
          ) : (
            <p>
              <strong>{prefilledCount} {prefilledCount === 1 ? "field" : "fields"} pre-filled</strong>
              Check each one marked Pre-filled and change what is wrong. The mark goes away once you edit a field.
            </p>
          )}
        </section>
      )}
      <div className="rf-grid">
        <div className="rf-col">
          <section className="card rf-meta" aria-label="Report details">
            <dl className="td-meta">
              <div><dt>Date</dt><dd>{formatDate(report.date)}</dd></div>
              <div><dt>Department</dt><dd>{report.dept}</dd></div>
              <div><dt>Owner</dt><dd>{owner?.name ?? report.owner}</dd></div>
              <div><dt>Status</dt><dd><StatusPill status={REPORT_STATUS[report.status]} /></dd></div>
              <div><dt>Created</dt><dd><When iso={report.createdAt} today={org.today} tzLabel={org.tzLabel} /></dd></div>
              <div><dt>Last updated</dt><dd><When iso={report.updatedAt} today={org.today} tzLabel={org.tzLabel} /></dd></div>
              <div><dt>Submitted</dt><dd>{report.submittedAt ? <When iso={report.submittedAt} today={org.today} tzLabel={org.tzLabel} /> : "Not yet"}</dd></div>
              <div><dt>Deadline</dt><dd>{deadlineText} {org.tzLabel}</dd></div>
            </dl>
          </section>
          <section className="card rf-nil">
            <div>
              <h2 className="td-h" id="rf-nil-h">Nil / clear report</h2>
              <p className="td-muted">Nothing to report today. Marks every field as No issues.</p>
            </div>
            <Switch
              aria-labelledby="rf-nil-h"
              checked={report.nil}
              onCheckedChange={(on) => (on ? setConfirmNil(true) : apply((r) => ({ ...r, nil: false, updatedAt: nowInTz(org.today, org.timezone) })))}
            />
          </section>
          <Accordion multiple className="rf-secs" value={open} onValueChange={(v) => setOpen(v as string[])}>
            {template.map((s) => (
              <ReportSection key={s.id} section={s} report={report} errors={errors} restricted={skip.includes(s.id)} prefilled={prefilled} onField={setField} />
            ))}
          </Accordion>
        </div>
        <ReportProgress done={done} total={total} attention={attention} onJump={jump} />
      </div>
      <ConfirmDialog
        open={confirmNil}
        onOpenChange={setConfirmNil}
        title="Mark this as a nil report?"
        text="Every field will be set to No issues and any details you entered will be cleared."
        confirmLabel="Mark as nil"
        onConfirm={setNil}
      />
    </>
  )
}
