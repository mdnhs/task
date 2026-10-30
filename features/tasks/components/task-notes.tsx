"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { When } from "@/components/when"
import { Textarea } from "@/components/ui/textarea"
import { listItem } from "@/lib/motion"
import type { TimelineEvent } from "../types"

const schema = z.string().trim().min(1, "Write a note first").max(1000, "Keep notes under 1000 characters")

export function TaskNotes({
  notes,
  canAdd,
  today,
  tzLabel,
  onAdd,
}: {
  notes: TimelineEvent[]
  canAdd: boolean
  today: string
  tzLabel: string
  onAdd(text: string): void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string>()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = schema.safeParse(text)
    if (!r.success) return setError(r.error.issues[0].message)
    onAdd(r.data)
    setText("")
    setError(undefined)
    toast.success("Note added")
  }

  return (
    <section className="card" aria-labelledby="td-notes-h">
      <h2 id="td-notes-h" className="td-h">Progress notes</h2>
      {notes.length === 0 && <p className="td-muted">No progress notes yet.</p>}
      <ul className="td-notes">
        <AnimatePresence initial={false}>
          {notes.map((n, i) => (
            <motion.li key={`${n.at}-${i}`} {...listItem}>
              <p>{n.text}</p>
              <span className="td-tl-meta">{n.by} · <When iso={n.at} today={today} tzLabel={tzLabel} /></span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {canAdd && (
        <form className="td-form" onSubmit={submit} noValidate>
          <Field label="New note" htmlFor="td-note" error={error}>
            <Textarea id="td-note" placeholder="e.g. Lobby done, starting floor 2" value={text} onChange={(e) => { setText(e.target.value); setError(undefined) }} />
          </Field>
          <div className="td-form-foot"><button type="submit" className="btn btn-primary">Add note</button></div>
        </form>
      )}
    </section>
  )
}
