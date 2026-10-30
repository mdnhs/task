"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ListPlus, NotebookPen, Paperclip, X, Zap } from "lucide-react"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { formatDate, formatTime } from "@/lib/dates"
import { extraSections, isRequired, sectionOn, submitReport, taskUpdatesFor, validateReport, windowLabel } from "@/lib/shift-report"
import { taskInbox } from "@/lib/task-inbox"
import { ITEM_STATUS, ITEM_STATUS_ORDER } from "../types"
import type { ItemStatus, ReportItem, ReportState, ShiftReport, TemplateSection } from "../types"
import type { ReportPageProps } from "./report-page"
import { ReportMeta, taskHref } from "./report-parts"

const STATUS_OPTIONS = ITEM_STATUS_ORDER.map((s) => ({ value: s, label: ITEM_STATUS[s].label }))
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * The member's report (FR-M1-23/24): one row per shift task (status, time, note), summary, blockers, unplanned work,
 * attachments and the team template's extra fields. Save draft keeps it editable; Submit validates against the template,
 * locks it (FR-M1-27) and queues the task updates (FR-M1-26) for the tasks store.
 */
export function ReportEditor({
  report: r,
  owner,
  template,
  state,
  apply,
  back,
  now,
  tzLabel,
  me,
  tenantId,
}: ReportPageProps & {
  report: ShiftReport
  owner: string
  template: TemplateSection[]
  state: ReportState
  apply(fn: (r: ShiftReport) => ShiftReport): void
  back: React.ReactNode
}) {
  const router = useRouter()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summaryOpen, setSummaryOpen] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (summaryOpen) summaryRef.current?.focus()
  }, [summaryOpen])

  const touch = (key: string, fn: (r: ShiftReport) => ShiftReport) => {
    setErrors((e) => {
      if (!e[key]) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
    apply((x) => ({ ...fn(x), updatedAt: now.slice(0, 16) }))
  }
  const setItem = (ref: string, key: string, patch: Partial<ReportItem>) =>
    touch(key, (x) => ({ ...x, items: x.items.map((i) => (i.taskRef === ref ? { ...i, ...patch } : i)) }))

  const save = () => {
    apply((x) => ({ ...x, updatedAt: now.slice(0, 16) }))
    toast.success("Draft saved")
  }
  const submit = () => {
    const errs = validateReport(r, template)
    if (errs.length) {
      setErrors(Object.fromEntries(errs.map((e) => [e.key, e.message])))
      setSummaryOpen(true)
      return false
    }
    const at = now.slice(0, 16)
    const next = submitReport(r, at, me)
    apply(() => next)
    taskInbox.pushUpdates(taskUpdatesFor(next, tenantId, me, at))
    setErrors({})
    setSummaryOpen(false)
    toast.success(`Report ${r.status === "returned" ? "resubmitted" : "submitted"} ${formatTime(at)} ${tzLabel}`, {
      description: `${next.items.length} ${next.items.length === 1 ? "task" : "tasks"} updated. Your manager can see it now.`,
    })
    router.push("/daily-reports")
  }

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return
    const stamp = Date.now().toString(36)
    // Mock: only the name and size are kept; nothing is uploaded.
    const list = [...files].map((f, i) => ({ id: `a-${stamp}-${i}`, name: f.name, kind: f.type.startsWith("image/") ? ("image" as const) : ("file" as const), size: kb(f.size) }))
    touch("attachments", (x) => ({ ...x, attachments: [...x.attachments, ...list] }))
    if (fileRef.current) fileRef.current.value = ""
  }

  const errorCount = Object.keys(errors).length
  const returned = r.status === "returned" ? r.comments.at(-1) : undefined
  const err = (k: string) => errors[k]
  const optional = (sec: "unplanned" | "attachments") => (isRequired(template, sec, sec) ? "Required" : "Optional")

  // Notes and the template's extra sections on the left; unplanned work and attachments on the right (ui-rules.md → Forms).
  const left = [
    (sectionOn(template, "summary") || sectionOn(template, "blockers")) && (
      <FormSection key="notes" icon={NotebookPen} title="Notes">
        {sectionOn(template, "summary") && (
          <Field label="Summary" htmlFor="sr-summary" error={err("summary")} required={isRequired(template, "summary", "summary")}>
            <Textarea id="sr-summary" value={r.summary} placeholder="e.g. Quiet shift, all patrols done" onChange={(e) => touch("summary", (x) => ({ ...x, summary: e.target.value }))} />
          </Field>
        )}
        {sectionOn(template, "blockers") && (
          <Field label="Blockers" htmlFor="sr-blockers" error={err("blockers")} required={isRequired(template, "blockers", "blockers")}>
            <Textarea id="sr-blockers" value={r.blockers} placeholder="e.g. Gate 3 card reader is down" onChange={(e) => touch("blockers", (x) => ({ ...x, blockers: e.target.value }))} />
          </Field>
        )}
      </FormSection>
    ),
    ...extraSections(template).map((s) => (
      <FormSection key={s.id} icon={ListPlus} title={s.title}>
        {s.fields.map((f) => {
          const k = `${s.id}.${f.id}`
          return (
            <Field key={f.id} label={f.label} htmlFor={`sr-x-${k}`} error={err(`extra:${k}`)} required={f.required}>
              <Textarea id={`sr-x-${k}`} className="sr-short" value={r.extra[k] ?? ""} onChange={(e) => touch(`extra:${k}`, (x) => ({ ...x, extra: { ...x.extra, [k]: e.target.value } }))} />
            </Field>
          )
        })}
      </FormSection>
    )),
  ].filter(Boolean)
  const right = [
    sectionOn(template, "unplanned") && (
      <FormSection key="unplanned" icon={Zap} title="Unplanned work" note={optional("unplanned")}>
        <fieldset className="sr-set" aria-describedby={err("unplanned") ? "sr-unplanned-e" : undefined}>
          <legend className="sr-only">Unplanned work</legend>
          {r.unplanned.map((u, n) => (
            <div key={u.id} className="sr-row">
              <input className="sr-in" type="text" aria-label={`Unplanned work ${n + 1}`} placeholder="What did you do?" value={u.text}
                onChange={(e) => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.map((y) => (y.id === u.id ? { ...y, text: e.target.value } : y)) }))} />
              <input className="sr-in sr-min num" type="number" inputMode="numeric" min={0} step={5} aria-label={`Unplanned work ${n + 1}, minutes`} placeholder="Min" value={u.minutes || ""}
                onChange={(e) => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.map((y) => (y.id === u.id ? { ...y, minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) } : y)) }))} />
              <button type="button" className="rf-entry-x" aria-label={`Remove unplanned work ${n + 1}`} onClick={() => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.filter((y) => y.id !== u.id) }))}>
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="rf-add" onClick={() => touch("unplanned", (x) => ({ ...x, unplanned: [...x.unplanned, { id: `u-${Date.now().toString(36)}`, text: "", minutes: 0 }] }))}>
            <Icon name="plus" /> Add unplanned work
          </button>
          {err("unplanned") && <p className="od-field-err" id="sr-unplanned-e">{err("unplanned")}</p>}
        </fieldset>
      </FormSection>
    ),
    sectionOn(template, "attachments") && (
      <FormSection key="attachments" icon={Paperclip} title="Attachments" note={optional("attachments")}>
        <fieldset className="sr-set" aria-describedby={err("attachments") ? "sr-att-e" : undefined}>
          <legend className="sr-only">Attachments</legend>
          {r.attachments.length > 0 && (
            <ul className="sr-list">
              {r.attachments.map((a) => (
                <li key={a.id}>
                  <span>{a.name}</span>
                  <span className="num">{a.size}</span>
                  <button type="button" className="rf-entry-x" aria-label={`Remove ${a.name}`} onClick={() => touch("attachments", (x) => ({ ...x, attachments: x.attachments.filter((y) => y.id !== a.id) }))}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileRef} type="file" multiple className="sr-only" id="sr-file" onChange={(e) => addAttachments(e.target.files)} />
          <label htmlFor="sr-file" className="rf-add">
            <Icon name="plus" /> Add photo or file
          </label>
          {err("attachments") && <p className="od-field-err" id="sr-att-e">{err("attachments")}</p>}
        </fieldset>
      </FormSection>
    ),
  ].filter(Boolean)
  const notesCard = (left.length > 0 || right.length > 0) && (
    <section className="card sr-notes" aria-label="Shift notes">
      {left.length > 0 && right.length > 0 ? (
        <div className="od-form-cols">
          <div className="od-form-col">{left}</div>
          <div className="od-form-col">{right}</div>
        </div>
      ) : (
        <div className="od-form-col">{left.length ? left : right}</div>
      )}
    </section>
  )

  return (
    <>
      {back}
      <PageHead
        title={`${r.shiftName} report`}
        subtitle={`${owner} · ${formatDate(r.date)} ${windowLabel(r)} · due ${formatTime(r.due)} ${tzLabel}`}
        actions={
          <>
            <ActionButton className="btn btn-outline rf-btn" onAction={save}>Save draft</ActionButton>
            <ActionButton className="btn btn-primary rf-btn" onAction={submit}>{r.status === "returned" ? "Resubmit" : "Submit"}</ActionButton>
          </>
        }
      />
      {summaryOpen && errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rf-summary">
          <strong>{errorCount} {errorCount === 1 ? "field needs" : "fields need"} attention before you can submit</strong>
          <span>{Object.values(errors).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</span>
        </div>
      )}
      {returned && (
        <div className="td-state warn sr-banner">
          <strong>Returned by {returned.by}</strong>
          <span>{returned.text}</span>
        </div>
      )}
      {state === "missing" && (
        <div className="td-state warn sr-banner">
          <strong>This report is missing</strong>
          <span>It was due <When iso={r.due} today={now} tzLabel={tzLabel} />. You can still submit it; it will be marked late.</span>
        </div>
      )}
      <div className="sr-col">
        <ReportMeta report={r} owner={owner} state={state} now={now} tzLabel={tzLabel} />
        {sectionOn(template, "tasks") && (
          <section className="card" aria-labelledby="sr-items-h">
            <div className="card-head">
              <div>
                <h2 id="sr-items-h">Tasks in the shift</h2>
                <div className="sub">
                  {r.items.length} {r.items.length === 1 ? "task" : "tasks"}
                  {isRequired(template, "tasks", "time") ? " · time needed for done and in-progress tasks" : ""}
                </div>
              </div>
            </div>
            {r.items.length === 0 ? (
              <p className="td-muted">No tasks were assigned to you for this shift. Use unplanned work for anything you did.</p>
            ) : (
              <div className="table-wrap">
                <table className="rtable sr-items sr-items-edit">
                  <thead>
                    <tr><th>Task</th><th>Status</th><th>Time (min)</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {r.items.map((i) => {
                      const mk = `item:${i.taskRef}:minutes`
                      const nk = `item:${i.taskRef}:note`
                      return (
                        <tr key={i.taskRef}>
                          <td data-label="Task">
                            <Link href={taskHref(i.taskRef)} className="tt rep-link">{i.title}</Link>
                            <div className="tm num">{i.taskRef}{i.due ? <> · due <When iso={i.due} today={now} tzLabel="" /></> : null}</div>
                          </td>
                          <td data-label="Status" className="sr-status">
                            <FilterSelect label={`Status of ${i.title}`} value={i.status} options={STATUS_OPTIONS} onChange={(v) => setItem(i.taskRef, mk, { status: v as ItemStatus })} />
                          </td>
                          <td data-label="Time (min)">
                            <input
                              className="sr-in sr-min num"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={5}
                              aria-label={`Time spent on ${i.title}, minutes`}
                              aria-invalid={err(mk) ? true : undefined}
                              aria-describedby={err(mk) ? `${mk}-e` : undefined}
                              value={i.minutes || ""}
                              placeholder="0"
                              onChange={(e) => setItem(i.taskRef, mk, { minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                            />
                            {err(mk) && <p className="od-field-err" id={`${mk}-e`}>{err(mk)}</p>}
                          </td>
                          <td data-label="Note">
                            <input
                              className="sr-in"
                              type="text"
                              aria-label={`Note on ${i.title}`}
                              aria-invalid={err(nk) ? true : undefined}
                              aria-describedby={err(nk) ? `${nk}-e` : undefined}
                              value={i.note}
                              placeholder={i.status === "blocked" ? "What is blocking it?" : "Add a note"}
                              onChange={(e) => setItem(i.taskRef, nk, { note: e.target.value })}
                            />
                            {err(nk) && <p className="od-field-err" id={`${nk}-e`}>{err(nk)}</p>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {notesCard}
      </div>
    </>
  )
}
