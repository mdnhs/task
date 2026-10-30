"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/dates"
import { knockOn, type DateMove } from "../planning"
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

/** The knock-on list (FR-M1-14). */
export function KnockOnList({ moves }: { moves: DateMove[] }) {
  if (moves.length === 0) return <p className="tpl-note">No dependent tasks move.</p>
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
      </ul>
    </div>
  )
}

/**
 * Manager reschedule (FR-M1-11) with the knock-on preview before saving (FR-M1-14). `initial` pre-fills the dates
 * (approving a member's proposal).
 */
export function RescheduleDialog({ open, onOpenChange, task, tasks, today, initial, title = "Reschedule", onSave }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  tasks: Task[]
  today: string
  initial?: { start: string; due: string }
  title?: string
  onSave(to: { start: string; due: string }, moves: DateMove[]): void
}) {
  const from = initial ?? { start: task.start, due: task.due }
  const [start, setStart] = useState(from.start.slice(0, 10))
  const [due, setDue] = useState(from.due.slice(0, 16))
  const [err, setErr] = useState("")
  const to = { start: `${start}T${task.start.slice(11, 19) || "09:00:00"}`, due: `${due}:00` }
  const moves = useMemo(() => (start && due ? knockOn(tasks, task.ref, to) : []), [tasks, task.ref, start, due]) // eslint-disable-line react-hooks/exhaustive-deps
  const unchanged = to.start === task.start && to.due === task.due

  function save(e: React.FormEvent) {
    e.preventDefault()
    const bad = dateErr(start, due)
    if (bad) return setErr(bad)
    onSave(to, moves)
    toast.success(moves.length ? `${task.ref} and ${moves.length} dependent task${moves.length === 1 ? "" : "s"} rescheduled` : `${task.ref} rescheduled`)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{task.ref}: now {when(task.start)} to {when(task.due)}. The assignee is notified.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <DateFields id="rs" start={start} due={due} today={today} onStart={(v) => { setStart(v); setErr("") }} onDue={(v) => { setDue(v); setErr("") }} />
          {err && <p className="rp-err" role="alert">{err}</p>}
          <KnockOnList moves={moves} />
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={unchanged}>Save dates</button>
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
  onSave(p: { start: string; due: string; reason: string }): void
}) {
  const [start, setStart] = useState(task.start.slice(0, 10))
  const [due, setDue] = useState(task.due.slice(0, 16))
  const [reason, setReason] = useState("")
  const [err, setErr] = useState("")
  function save(e: React.FormEvent) {
    e.preventDefault()
    const bad = dateErr(start, due) || (reason.trim().length < 3 ? "Say why the dates should change" : "")
    if (bad) return setErr(bad)
    onSave({ start: `${start}T${task.start.slice(11, 19) || "09:00:00"}`, due: `${due}:00`, reason: reason.trim() })
    toast.success("Date change sent to your manager")
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Propose new dates</DialogTitle>
          <DialogDescription>Only managers change timelines. Your manager approves or declines this.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <DateFields id="pp" start={start} due={due} today={today} onStart={(v) => { setStart(v); setErr("") }} onDue={(v) => { setDue(v); setErr("") }} />
          <Field label="Reason" htmlFor="pp-reason" required>
            <Textarea id="pp-reason" value={reason} onChange={(e) => { setReason(e.target.value); setErr("") }} />
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

/** People as toggle chips (several assignees, FR-M1-01). The first picked is the primary assignee. */
export function PeopleChips({ people, value, onChange, label }: { people: Person[]; value: string[]; onChange(ids: string[]): void; label: string }) {
  return (
    <div className="er-types" role="group" aria-label={label}>
      {people.map((p) => {
        const on = value.includes(p.id)
        return (
          <button key={p.id} type="button" className="rp-day" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}>
            {p.name}
            {value[0] === p.id && <span className="er-pc"> · primary</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ReassignDialog({ open, onOpenChange, task, people, onSave }: { open: boolean; onOpenChange(o: boolean): void; task: Task; people: Person[]; onSave(ids: string[]): void }) {
  const [ids, setIds] = useState<string[]>([task.assignee, ...(task.assignees ?? [])])
  const [err, setErr] = useState("")
  function save(e: React.FormEvent) {
    e.preventDefault()
    if (ids.length === 0) return setErr("Choose at least one person")
    onSave(ids)
    toast.success(`${task.ref} reassigned`)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reassign</DialogTitle>
          <DialogDescription>Pick who works on {task.ref}. Everyone added or removed is notified.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <PeopleChips people={people} value={ids} onChange={(v) => { setIds(v); setErr("") }} label="Assignees" />
          {err && <p className="rp-err" role="alert">{err}</p>}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
