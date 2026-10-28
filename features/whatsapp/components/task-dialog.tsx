"use client"

import { useState } from "react"
import { z } from "zod"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

const schema = z.object({
  title: z.string().trim().min(5, "Give the task a title of at least 5 characters").max(120, "Keep the title under 120 characters"),
  description: z.string().trim().max(1000, "Keep the description under 1000 characters"),
  due: z.string().min(1, "Choose a due date"),
})

export type NewTask = { title: string; description: string; assignee: string; due: string }

/** First real sentence of the message (skipping greetings like "Morning."), cut to a title length. */
function titleFrom(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s/).map((s) => s.trim()).filter(Boolean)
  const first = (sentences.find((s) => s.length >= 15) ?? sentences[0] ?? "").replace(/[.!?]$/, "")
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first
}

// FR-WA-02/04: create a task from a message, pre-filled from its text or transcript. Mount with a fresh `key` per open.
export function TaskDialog({
  open,
  onOpenChange,
  text,
  source,
  assignees,
  defaultAssignee,
  today,
  onCreate,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  /** Message text or transcript the task starts from. */
  text: string
  /** "From WhatsApp: Daniel Okafor" line kept in the description. */
  source: string
  assignees: string[]
  defaultAssignee?: string
  today: string
  onCreate(t: NewTask): void
}) {
  const [title, setTitle] = useState(titleFrom(text))
  const [description, setDescription] = useState(text ? `${text}\n\n${source}` : source)
  const [assignee, setAssignee] = useState(defaultAssignee && assignees.includes(defaultAssignee) ? defaultAssignee : assignees[0] ?? "")
  const [due, setDue] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ title, description, due })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = String(i.path[0])
        if (!next[k]) next[k] = i.message
      }
      return setErrors(next)
    }
    onCreate({ ...parsed.data, assignee })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Create task from message</DialogTitle>
          <DialogDescription>Pre-filled from the message. The task links back to it and the thread records who created it.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Title" htmlFor="wa-task-title" error={errors.title} required>
            <input id="wa-task-title" value={title} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: undefined })) }} />
          </Field>
          <Field label="Description" htmlFor="wa-task-desc" error={errors.description}>
            <Textarea id="wa-task-desc" value={description} onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: undefined })) }} />
          </Field>
          <Field label="Assignee" htmlFor="wa-task-assignee" required>
            <FilterSelect label="Assignee" value={assignee} options={assignees.map((a) => ({ value: a, label: a }))} onChange={setAssignee} />
          </Field>
          <Field label="Due date" htmlFor="wa-task-due" error={errors.due} required>
            <DatePicker label="Due date" value={due} today={today} min={today.slice(0, 10)} placeholder="Pick a due date" onChange={(v) => { setDue(v); setErrors((x) => ({ ...x, due: undefined })) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Create task</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
