"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { apiBrowser } from "@/lib/api/browser"
import { classifyApiError, userMessage } from "@/lib/api/problem"
import { formatDate, formatTime } from "@/lib/dates"
import { extraSections, isRequired, sectionOn, validateReport, windowLabel } from "@/lib/shift-report"
import { fieldErrorsOf, forValidation } from "../adapters"
import { ReportFileRefused, makeReportsClient } from "../client"
import { isEditable, makeDraftSession, type SessionSnapshot } from "../session"
import { reportStateAt } from "../time"
import { ITEM_STATUS, ITEM_STATUS_ORDER } from "../types"
import type { ItemStatus, ReportItem, ShiftReport, TemplateSection } from "../types"
import type { ReportPageProps } from "./report-page"
import { AttachmentLine, ReportMeta, taskHref } from "./report-parts"

const STATUS_OPTIONS = ITEM_STATUS_ORDER.map((s) => ({ value: s, label: ITEM_STATUS[s].label }))
/** A short random suffix for a new unplanned row (a row id, never a time). */
const rowId = () => `u-${crypto.randomUUID().slice(0, 8)}`

/**
 * The member's report (FR-M1-23/24) on the API (B6 T6.7): one row per shift task (status, time, note), summary, blockers, unplanned work, attachments and the team template's extra fields.
 *  - Edits autosave through a debounced (800 ms) PUT …/draft that carries the report `version` and adopts the one the server answers with; "Save draft" flushes it at once. A 409
 *    version_conflict (another tab, or a manager) KEEPS the typed text and shows "Someone changed this report. Your text is kept." with Keep mine / Reload theirs (session.ts).
 *  - Submit flushes the draft, validates against the team template, then sends { version, requestId }. The request id is made once per attempt and REUSED on a retry (F7), so a network
 *    error followed by another tap can never submit twice; a double tap sends one request. A submit locks the report (FR-M1-27); the API updates the tasks of the rows (FR-M1-26).
 *  - Row notes stay in the report (H4); task history only gets a neutral line from the API.
 *  - Attachments: upload intent, direct PUT, complete, wait for the malware scan (Scanning, then clean; an infected file is refused).
 */
export function ReportEditor({
  report,
  owner,
  template,
  back,
  now,
  nowAt,
  tz,
  tzLabel,
}: ReportPageProps & {
  report: ShiftReport
  owner: string
  template: TemplateSection[]
  back: React.ReactNode
}) {
  const router = useRouter()
  const client = useState(() => makeReportsClient(apiBrowser, tz))[0]
  const [snap, setSnap] = useState<SessionSnapshot>({ form: report, conflict: null, conflictState: "none" })
  // the session owns the form, the debounced autosave and the idempotent submit; a 409 never discards the user's text (banner: Keep mine / Reload theirs)
  const [session] = useState(() => makeDraftSession({ client, report, onChange: setSnap, onError: (e) => toast.error(`Draft not saved. ${userMessage(e).text}`) }))
  const r = snap.form
  const conflict = snap.conflictState
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const summaryRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const live = useRef(true)
  const state = reportStateAt(r, nowAt)

  useEffect(() => {
    live.current = true
    if (summaryOpen) summaryRef.current?.focus()
    return () => {
      live.current = false
    }
  }, [summaryOpen])
  // leaving the page: save what is pending (the request outlives the page)
  useEffect(() => () => session.leave(), [session])

  const touch = (key: string, fn: (r: ShiftReport) => ShiftReport) => {
    setErrors((e) => {
      if (!e[key]) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
    session.edit(fn(session.snapshot().form))
  }
  const setItem = (ref: string, key: string, patch: Partial<ReportItem>) =>
    touch(key, (x) => ({ ...x, items: x.items.map((i) => (i.taskRef === ref ? { ...i, ...patch } : i)) }))

  /** Their version replaces the form; when it is no longer a draft or returned (submitted or accepted elsewhere) the page refreshes so the editor becomes read-only. */
  const reloadTheirs = async () => {
    const fresh = await session.reloadTheirs()
    if (fresh && !isEditable(fresh)) router.refresh()
  }

  const save = async () => {
    if (!(await session.flush())) return false
    toast.success("Draft saved")
  }

  const submit = async () => {
    const errs = validateReport(forValidation(session.snapshot().form), template)
    if (errs.length) {
      setErrors(Object.fromEntries(errs.map((e) => [e.key, e.message])))
      setSummaryOpen(true)
      return false
    }
    setErrors({})
    setSummaryOpen(false)
    try {
      const res = await session.submit()
      if (res.kind === "choose") {
        toast("Choose Keep mine or Reload theirs first.")
        return false
      }
      if (res.kind !== "ok") return false
      const sent = res.report
      toast.success(`Report ${r.status === "returned" ? "resubmitted" : "submitted"} ${formatTime(sent.submittedAt ?? now)} ${tzLabel}`, {
        description: `${sent.items.length} ${sent.items.length === 1 ? "task" : "tasks"} updated. Your manager can see it now.`,
      })
      router.push("/daily-reports")
      router.refresh()
    } catch (e) {
      const kind = classifyApiError(e).kind
      const fields = fieldErrorsOf(e)
      if (Object.keys(fields).length) {
        setErrors(fields)
        setSummaryOpen(true)
      } else if (classifyApiError(e).code === "report_locked") {
        toast.error(userMessage(e).text)
        router.refresh()
      } else if (kind === "network") {
        // the request id is kept: pressing Submit again retries the SAME submission
        toast.error("No connection. Your report is saved here: tap Submit again.")
      } else {
        const m = userMessage(e)
        toast.error(m.ref ? `${m.text} (Ref ${m.ref})` : m.text)
      }
      return false
    }
  }

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    if (fileRef.current) fileRef.current.value = ""
    for (const f of list) {
      setUploading((u) => [...u, f.name])
      try {
        // the attachment needs the report's uuid: it was opened before this page rendered
        const att = await client.upload(session.snapshot().form, f)
        touch("attachments", (x) => ({ ...x, attachments: [...x.attachments, att] }))
      } catch (e) {
        if (e instanceof ReportFileRefused) {
          toast.error(
            e.reason === "infected" ? `${f.name} failed the malware scan and was not attached.` : e.reason === "slow" ? `${f.name} is still being scanned. Try again in a moment.` : `${f.name} could not be uploaded.`,
          )
        } else {
          toast.error(userMessage(e).text)
        }
      } finally {
        if (live.current) setUploading((u) => u.filter((n, i) => !(n === f.name && i === u.indexOf(f.name))))
      }
    }
  }

  const errorCount = Object.keys(errors).length
  const returned = r.status === "returned" ? r.comments.at(-1) : undefined
  const err = (k: string) => errors[k]
  const optional = (sec: "unplanned" | "attachments") => (isRequired(template, sec, sec) ? "Required" : "Optional")

  // Notes and the template's extra sections on the left; unplanned work and attachments on the right (ui-rules.md → Forms).
  const left = [
    (sectionOn(template, "summary") || sectionOn(template, "blockers")) && (
      <FormSection key="notes" icon="note-pen" title="Notes">
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
      <FormSection key={s.id} icon="list-plus" title={s.title}>
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
      <FormSection key="unplanned" icon="zap" title="Unplanned work" note={optional("unplanned")}>
        <fieldset className="sr-set" aria-describedby={err("unplanned") ? "sr-unplanned-e" : undefined}>
          <legend className="sr-only">Unplanned work</legend>
          {r.unplanned.map((u, n) => (
            <div key={u.id} className="sr-row">
              <input className="sr-in" type="text" aria-label={`Unplanned work ${n + 1}`} placeholder="What did you do?" value={u.text}
                onChange={(e) => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.map((y) => (y.id === u.id ? { ...y, text: e.target.value } : y)) }))} />
              <input className="sr-in sr-min num" type="number" inputMode="numeric" min={0} step={5} aria-label={`Unplanned work ${n + 1}, minutes`} placeholder="Min" value={u.minutes || ""}
                onChange={(e) => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.map((y) => (y.id === u.id ? { ...y, minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) } : y)) }))} />
              <button type="button" className="rf-entry-x" aria-label={`Remove unplanned work ${n + 1}`} onClick={() => touch("unplanned", (x) => ({ ...x, unplanned: x.unplanned.filter((y) => y.id !== u.id) }))}>
                <Icon name="close" size={24} />
              </button>
            </div>
          ))}
          <button type="button" className="rf-add" onClick={() => touch("unplanned", (x) => ({ ...x, unplanned: [...x.unplanned, { id: rowId(), text: "", minutes: 0 }] }))}>
            <Icon name="plus" /> Add unplanned work
          </button>
          {err("unplanned") && <p className="od-field-err" id="sr-unplanned-e">{err("unplanned")}</p>}
        </fieldset>
      </FormSection>
    ),
    sectionOn(template, "attachments") && (
      <FormSection key="attachments" icon="paperclip" title="Attachments" note={optional("attachments")}>
        <fieldset className="sr-set" aria-describedby={err("attachments") ? "sr-att-e" : undefined}>
          <legend className="sr-only">Attachments</legend>
          {r.attachments.length > 0 && (
            <ul className="sr-list">
              {r.attachments.map((a) => (
                <AttachmentLine
                  key={a.id}
                  a={a}
                  reportId={r.reportId}
                  action={
                    <button type="button" className="rf-entry-x" aria-label={`Remove ${a.name}`} onClick={() => touch("attachments", (x) => ({ ...x, attachments: x.attachments.filter((y) => y.id !== a.id) }))}>
                      <Icon name="close" size={24} />
                    </button>
                  }
                />
              ))}
            </ul>
          )}
          {uploading.length > 0 && (
            <ul className="sr-list" aria-live="polite">
              {uploading.map((n, i) => (
                <li key={`${n}:${i}`}>
                  <span>{n}</span>
                  <span className="num">Scanning…</span>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileRef} type="file" multiple className="sr-only" id="sr-file" onChange={(e) => void addAttachments(e.target.files)} />
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
      {conflict !== "none" && (
        <div className="td-state warn sr-banner" role="alert">
          <strong>Someone changed this report</strong>
          <span>{conflict === "unavailable" ? "Your text is kept. Their version could not be loaded: try again." : "Your text is kept."}</span>
          <div className="sr-banner-actions">
            <button type="button" className="btn btn-primary" onClick={() => void session.keepMine()}>Keep mine</button>
            <button type="button" className="btn btn-outline" onClick={() => void reloadTheirs()}>Reload theirs</button>
          </div>
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
