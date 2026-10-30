"use client"

import { useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { listItem } from "@/lib/motion"
import { checklistProgress, wouldCycle } from "../planning"
import { STATUS } from "../types"
import type { Task } from "../types"

/** FR-M1-02 checklist: tick items; add/remove when the viewer may edit the task. */
export function ChecklistCard({ task, canTick, canEdit, onToggle, onAdd, onRemove }: {
  task: Task
  canTick: boolean
  canEdit: boolean
  onToggle(id: string): void
  onAdd(text: string): void
  onRemove(id: string): void
}) {
  const [text, setText] = useState("")
  const [err, setErr] = useState("")
  const list = task.checklist ?? []
  const pr = checklistProgress(task)
  if (!list.length && !canEdit) return null
  return (
    <section className="card" aria-labelledby="td-cl-h">
      <div className="card-head">
        <div>
          <h2 id="td-cl-h" className="td-h">Checklist</h2>
          <div className="sub">{pr ? `${pr.done} of ${pr.total} done` : "No items yet"}</div>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="cl-list">
          <AnimatePresence initial={false}>
            {list.map((c) => (
              <motion.li key={c.id} className="cl-item" {...listItem}>
                <button type="button" role="checkbox" aria-checked={c.done} className="cl-box" disabled={!canTick} onClick={() => onToggle(c.id)}>
                  <span className="cl-tick" aria-hidden="true" />
                  <span className="cl-text">{c.text}</span>
                </button>
                {canEdit && (
                  <button type="button" className="tpl-link bad cl-rm" aria-label={`Remove ${c.text}`} onClick={() => onRemove(c.id)}>Remove</button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {canEdit && (
        <form
          className="cl-add"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim().length < 2) return setErr("Write the item")
            onAdd(text)
            setText("")
          }}
        >
          <Field label="New item" htmlFor="cl-new" error={err || undefined}>
            <Input id="cl-new" value={text} maxLength={120} onChange={(e) => { setText(e.target.value); setErr("") }} />
          </Field>
          <button type="submit" className="btn btn-outline">Add item</button>
        </form>
      )}
    </section>
  )
}

/** FR-M1-02 subtasks: child tasks with their own status; a manager adds one by title. */
export function SubtasksCard({ subtasks, canAdd, onAdd }: { subtasks: Task[]; canAdd: boolean; onAdd(title: string): void }) {
  const [text, setText] = useState("")
  const [err, setErr] = useState("")
  if (!subtasks.length && !canAdd) return null
  const done = subtasks.filter((t) => t.status === "completed").length
  return (
    <section className="card" aria-labelledby="td-sub-h">
      <div className="card-head">
        <div>
          <h2 id="td-sub-h" className="td-h">Subtasks</h2>
          <div className="sub">{subtasks.length ? `${done} of ${subtasks.length} completed` : "No subtasks yet"}</div>
        </div>
      </div>
      {subtasks.length > 0 && (
        <ul className="sub-list">
          {subtasks.map((t) => (
            <li key={t.ref} className="sub-item">
              <Link href={`/tasks/${t.ref}`} className="sub-link">
                <span className="tt">{t.title}</span>
                <span className="tm num">{t.ref}</span>
              </Link>
              <StatusPill status={STATUS[t.status]} />
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form
          className="cl-add"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim().length < 3) return setErr("Enter a title of at least 3 characters")
            onAdd(text)
            setText("")
          }}
        >
          <Field label="New subtask" htmlFor="sub-new" error={err || undefined}>
            <Input id="sub-new" value={text} maxLength={120} onChange={(e) => { setText(e.target.value); setErr("") }} />
          </Field>
          <button type="submit" className="btn btn-outline">Add subtask</button>
        </form>
      )}
    </section>
  )
}

/** Manager edits finish-to-start dependencies; loops are refused (FR-M1-02). */
export function DependenciesDialog({ open, onOpenChange, task, tasks, onSave }: { open: boolean; onOpenChange(o: boolean): void; task: Task; tasks: Task[]; onSave(refs: string[]): void }) {
  const [refs, setRefs] = useState<string[]>(task.dependsOn ?? [])
  const [pick, setPick] = useState("")
  const [err, setErr] = useState("")
  const options = tasks.filter((t) => t.ref !== task.ref && !t.archivedAt && !refs.includes(t.ref) && t.status !== "cancelled")
  function add(ref: string) {
    setPick("")
    if (!ref) return
    if (wouldCycle(tasks, task.ref, ref)) return setErr(`${ref} already depends on ${task.ref}, so this would make a loop`)
    setRefs((r) => [...r, ref])
    setErr("")
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Depends on</DialogTitle>
          <DialogDescription>{task.ref} should start only after these tasks finish.</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            onSave(refs)
            toast.success("Dependencies saved")
            onOpenChange(false)
          }}
        >
          <Field label="Add a task" htmlFor="dep-add" error={err || undefined}>
            <FilterSelect label="Add a task" value={pick} options={[{ value: "", label: "Choose…" }, ...options.map((t) => ({ value: t.ref, label: `${t.ref} · ${t.title}` }))]} onChange={add} />
          </Field>
          {refs.length > 0 ? (
            <ul className="sub-list">
              {refs.map((r) => (
                <li key={r} className="sub-item">
                  <span className="tt"><span className="num">{r}</span> {tasks.find((t) => t.ref === r)?.title ?? ""}</span>
                  <button type="button" className="tpl-link bad" onClick={() => setRefs((x) => x.filter((y) => y !== r))}>Remove</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tpl-note">No dependencies.</p>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
