"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { PeoplePicker } from "@/components/form-section"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/dates"
import type { DateMove } from "../planning"
import type { Person, Task } from "../types"

const when = (iso: string) => `${formatDate(iso)} ${iso.slice(11, 16)}`
const dateErr = (start: string, due: string) => (!start ? "Choose a start date" : !due ? "Choose a due date" : due.slice(0, 10) < start ? "Due can't be before the start" : "")

/** Start date + due date-time fields, shared by Reschedule and Propose. */
function DateFields({ id, start, due, today, onStart, onDue }: { id: string; start: string; due: string; today: string; onStart(v: string): void; onDue(v: string): void }) {
  return (
    <div className="od-row2">
      <Field label="Start" htmlFor={`${id}-start`}>
        <DatePicker label="Start" value={start} today={today} onChange={onStart} />
      </Field>
      <Field label="Due" htmlFor={`${id}-due`}>
        <DatePicker label="Due" value={due} today={today} min={start} withTime onChange={onDue} />
      </Field>
    </div>
  )
}

/** The knock-on list (FR-M1-14). Tasks the caller may not see are opaque: only how many would move is shown (E15, `hiddenMoves`), never what they are. */
export function KnockOnList({ moves, hidden = 0 }: { moves: DateMove[]; hidden?: number }) {
  if (moves.length === 0 && hidden === 0) return <p className="tpl-note">No dependent tasks move.</p>
  return (
    <div className="ko-box" role="status">
      <strong>These dependent tasks move too</strong>
      <ul className="ko-list">
        {moves.map((m) => (
          <li key={m.ref}>
            <span className="num">{m.ref}</span> {m.title}
            <span className="ko-dates num">Due {when(m.from.due)} → {when(m.to.due)}</span>
          </li>
        ))}
        {hidden > 0 && <li className="ko-hidden"><span className="num">{hidden}</span> more task{hidden === 1 ? "" : "s"} outside your view also move</li>}
      </ul>
    </div>
  )
}

/** What POST /reschedule/preview answered: the moves the caller may see, how many it may not, and the hash the apply must send back (D20). */
export type PreviewData = { moves: DateMove[]; hidden: number; hash: string }
/** `changed`: the picture moved while the manager looked (409 knock_on_changed): the dialog previews again and the manager decides again. */
export type SaveResult = "ok" | "changed" | "failed"

/**
 * Manager reschedule (FR-M1-11) with the SERVER's knock-on preview before saving (FR-M1-14, D20). `initial` is a member's proposal being approved: its dates are fixed
 * (approving applies exactly what was proposed). Save sends the preview's hash; if the picture changed meanwhile the preview is shown again.
 */
export function RescheduleDialog({ open, onOpenChange, task, today, initial, title = "Reschedule", onPreview, onSave }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  today: string
  initial?: { start: string; due: string }
  title?: string
  onPreview(to: { start: string; due: string }): Promise<PreviewData | null>
  onSave(to: { start: string; due: string }, knockOn: { apply: false } | { apply: true; previewHash: string }): Promise<SaveResult>
}) {
  const from = initial ?? { start: task.start, due: task.due }
  const [start, setStart] = useState(from.start.slice(0, 10))
  const [due, setDue] = useState(from.due.slice(0, 16))
  const [err, setErr] = useState("")
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)
  const to = { start: `${start}T${initial ? initial.start.slice(11, 19) || "09:00:00" : task.start.slice(11, 19) || "09:00:00"}`, due: `${due}:00` }
  const unchanged = !initial && to.start === task.start && to.due === task.due

  const look = useCallback(async (dates: { start: string; due: string }) => {
    const mine = ++seq.current
    setLooking(true)
    const p = await onPreview(dates)
    if (mine !== seq.current) return // a newer look is running
    setPreview(p)
    setLooking(false)
  }, [onPreview])
  useEffect(() => {
    if (!open || !start || !due || dateErr(start, due) || unchanged) {
      seq.current++
      return void Promise.resolve().then(() => { setPreview(null); setLooking(false) })
    }
    const t = window.setTimeout(() => void look(to), 250)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start, due, unchanged])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const bad = dateErr(start, due)
    if (bad) return setErr(bad)
    if (looking) return
    setSaving(true)
    const r = await onSave(to, preview && preview.moves.length + preview.hidden > 0 ? { apply: true, previewHash: preview.hash } : { apply: false })
    setSaving(false)
    if (r === "ok") {
      toast.success(preview && preview.moves.length ? `${task.ref} and ${preview.moves.length} dependent task${preview.moves.length === 1 ? "" : "s"} rescheduled` : `${task.ref} rescheduled`)
      onOpenChange(false)
    } else if (r === "changed") {
      toast.error("Other tasks changed. Check the preview and save again.")
      await look(to)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{task.ref}: now {when(task.start)} to {when(task.due)}. The assignee is notified.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          {initial ? (
            <p className="tpl-note">Proposed: start {when(initial.start)}, due {when(initial.due)}.</p>
          ) : (
            <DateFields id="rs" start={start} due={due} today={today} onStart={(v) => { setStart(v); setErr("") }} onDue={(v) => { setDue(v); setErr("") }} />
          )}
          {err && <p className="rp-err" role="alert">{err}</p>}
          {preview ? <KnockOnList moves={preview.moves} hidden={preview.hidden} /> : <p className="tpl-note" aria-live="polite">{looking ? "Checking dependent tasks…" : "Pick new dates to see what moves."}</p>}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={unchanged || looking || saving}>{initial ? "Approve dates" : "Save dates"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Member proposes new dates (Q8); a manager approves or declines. */
export function ProposeDialog({ open, onOpenChange, task, today, onSave }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  today: string
  onSave(p: { start: string; due: string; reason: string }): Promise<boolean>
}) {
  const [start, setStart] = useState(task.start.slice(0, 10))
  const [due, setDue] = useState(task.due.slice(0, 16))
  const [reason, setReason] = useState("")
  const [err, setErr] = useState("")
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const bad = dateErr(start, due) || (reason.trim().length < 3 ? "Say why the dates should change" : "")
    if (bad) return setErr(bad)
    if (!(await onSave({ start: `${start}T${task.start.slice(11, 19) || "09:00:00"}`, due: `${due}:00`, reason: reason.trim() }))) return
    toast.success("Date change sent to your manager")
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Propose new dates</DialogTitle>
          <DialogDescription>Your manager approves or declines the change.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <DateFields id="pp" start={start} due={due} today={today} onStart={(v) => { setStart(v); setErr("") }} onDue={(v) => { setDue(v); setErr("") }} />
          <Field label="Reason" htmlFor="pp-reason" required>
            <Textarea id="pp-reason" placeholder="e.g. Parts arrive on Friday" value={reason} onChange={(e) => { setReason(e.target.value); setErr("") }} />
          </Field>
          {err && <p className="rp-err" role="alert">{err}</p>}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Send proposal</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ReassignDialog({ open, onOpenChange, task, people, onSave }: { open: boolean; onOpenChange(o: boolean): void; task: Task; people: Person[]; onSave(primary: string, others: string[]): Promise<boolean> }) {
  // The primary assignee comes first (FR-M1-01); with no primary, the first other person takes its place.
  const [primary, setPrimary] = useState(task.assignee)
  const [others, setOthers] = useState<string[]>(task.assignees ?? [])
  const [err, setErr] = useState("")
  const ids = [...new Set([primary, ...others].filter(Boolean))]
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (ids.length === 0) return setErr("Choose at least one person")
    if (!(await onSave(ids[0]!, ids.slice(1)))) return
    toast.success(`${task.ref} reassigned`)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reassign</DialogTitle>
          <DialogDescription>Who works on {task.ref}. Everyone added or removed is notified.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <Field label="Assignee" htmlFor="ra-assignee" error={err || undefined}>
            <FilterSelect
              label="Assignee"
              value={primary}
              options={[{ value: "", label: "Choose…" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => { setPrimary(v); setErr("") }}
            />
          </Field>
          <Field label="Also assigned" htmlFor="ra-others">
            <PeoplePicker people={people} value={others} onChange={(v) => { setOthers(v); setErr("") }} label="Also assigned" exclude={[primary]} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
