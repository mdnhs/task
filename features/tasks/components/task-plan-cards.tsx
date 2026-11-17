"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { listItem } from "@/lib/motion"
import { checklistProgress } from "../planning"
import { STATUS } from "../types"
import type { Task } from "../types"

/** FR-M1-02 checklist: tick items; add/remove when the viewer may edit the task. */
export function ChecklistCard({ task, canTick, canEdit, onToggle, onAdd, onRemove }: {
  task: Task
  canTick: boolean
  canEdit: boolean
  /** `done` is the NEW value (absolute, never a flip): two quick clicks cannot cancel each other out on the server. */
  onToggle(id: string, done: boolean): Promise<boolean>
  onAdd(text: string): Promise<boolean>
  onRemove(id: string): Promise<boolean>
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
                <button type="button" role="checkbox" aria-checked={c.done} className="cl-box" disabled={!canTick} onClick={() => void onToggle(c.id, !c.done)}>
                  <span className="cl-tick" aria-hidden="true" />
                  <span className="cl-text">{c.text}</span>
                </button>
                {canEdit && (
                  <button type="button" className="tpl-link bad cl-rm" aria-label={`Remove ${c.text}`} onClick={() => void onRemove(c.id)}>Remove</button>
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
          onSubmit={async (e) => {
            e.preventDefault()
            if (text.trim().length < 2) return setErr("Write the item")
            if (await onAdd(text.trim())) setText("")
          }}
        >
          <Field label="New item" htmlFor="cl-new" error={err || undefined}>
            <Input id="cl-new" placeholder="e.g. Check the fire exits" value={text} maxLength={120} onChange={(e) => { setText(e.target.value); setErr("") }} />
          </Field>
          <button type="submit" className="btn btn-outline">Add item</button>
        </form>
      )}
    </section>
  )
}

/** FR-M1-02 subtasks: child tasks with their own status; a manager adds one by title. */
export function SubtasksCard({ subtasks, canAdd, onAdd }: { subtasks: NonNullable<Task["subtasks"]>; canAdd: boolean; onAdd(title: string): Promise<boolean> }) {
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
          onSubmit={async (e) => {
            e.preventDefault()
            if (text.trim().length < 3) return setErr("Enter a title of at least 3 characters")
            if (await onAdd(text.trim())) setText("")
          }}
        >
          <Field label="New subtask" htmlFor="sub-new" error={err || undefined}>
            <Input id="sub-new" placeholder="e.g. Order new signage" value={text} maxLength={120} onChange={(e) => { setText(e.target.value); setErr("") }} />
          </Field>
          <button type="submit" className="btn btn-outline">Add subtask</button>
        </form>
      )}
    </section>
  )
}

export type DepChoice = { id: string; ref: string; title: string }

/**
 * Manager edits finish-to-start dependencies (FR-M1-02). Candidates come from the API's own task search (the caller's scope, 25 hits), so nothing is chosen from a list the
 * page holds; a loop is refused by the API (422 dependency_cycle, shown with its mapped copy).
 */
export function DependenciesDialog({ open, onOpenChange, task, search, onSave }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  search(q: string): Promise<DepChoice[]>
  onSave(ids: string[]): Promise<boolean>
}) {
  const [chosen, setChosen] = useState<DepChoice[]>(() => (task.dependsOnIds ?? []).map((id, i) => ({ id, ref: task.dependsOn?.[i] ?? id, title: "" })))
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<DepChoice[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current
    if (q.trim().length < 2) return void Promise.resolve().then(() => mine === seq.current && setHits([]))
    const t = window.setTimeout(async () => {
      const found = await search(q.trim())
      if (mine === seq.current) setHits(found.filter((h) => h.id !== task.id && !chosen.some((c) => c.id === h.id)))
    }, 200)
    return () => window.clearTimeout(t)
  }, [q, search, task.id, chosen])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Depends on</DialogTitle>
          <DialogDescription>{task.ref} starts after these finish.</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const ok = await onSave(chosen.map((c) => c.id))
            setBusy(false)
            if (!ok) return
            toast.success("Dependencies saved")
            onOpenChange(false)
          }}
        >
          <Field label="Find a task" htmlFor="dep-add">
            <Input id="dep-add" placeholder="Search by title or ref…" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          {hits.length > 0 && (
            <ul className="sub-list">
              {hits.map((h) => (
                <li key={h.id} className="sub-item">
                  <span className="tt"><span className="num">{h.ref}</span> {h.title}</span>
                  <button type="button" className="tpl-link" onClick={() => { setChosen((c) => [...c, h]); setQ("") }}>Add</button>
                </li>
              ))}
            </ul>
          )}
          {chosen.length > 0 ? (
            <ul className="sub-list">
              {chosen.map((r) => (
                <li key={r.id} className="sub-item">
                  <span className="tt"><span className="num">{r.ref}</span> {r.title}</span>
                  <button type="button" className="tpl-link bad" onClick={() => setChosen((x) => x.filter((y) => y.id !== r.id))}>Remove</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tpl-note">No dependencies.</p>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
