"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import type { Status } from "@/lib/types"
import { listItem } from "@/lib/motion"
import type { Evidence } from "../types"

const REVIEW: Record<Evidence["review"], Status> = {
  pending: { tone: "mute", label: "Pending review" },
  accepted: { tone: "ok", label: "Accepted" },
  rejected: { tone: "bad", label: "Rejected" },
  info_requested: { tone: "warn", label: "Info requested" },
}
const KIND: Record<Evidence["kind"], string> = { image: "Image", file: "File", link: "Link", note: "Note" }

type Decision = Exclude<Evidence["review"], "pending">
type Upload = { id: number; name: string; kind: "image" | "file"; pct: number }

const linkSchema = z
  .string()
  .trim()
  .min(1, "Paste a link")
  .refine((v) => /^https?:\/\/\S+\.\S+/.test(v), "Enter a full link starting with http:// or https://")
const noteSchema = z.string().trim().min(1, "Write the note").max(500, "Keep it under 500 characters")
const reasonSchema = z.string().trim().min(3, "Give a short reason")

export function EvidencePanel({
  evidence,
  required,
  canAdd,
  canReview,
  today,
  tzLabel,
  onAdd,
  onReview,
}: {
  evidence: Evidence[]
  required: boolean
  /** The viewer may attach evidence (open task, write access). */
  canAdd: boolean
  /** The viewer is a reviewer who may accept / reject / request info. */
  canReview: boolean
  today: string
  tzLabel: string
  onAdd(item: { kind: Evidence["kind"]; name: string }): void
  onReview(id: string, review: Decision, reason?: string): void
}) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const seq = useRef(0)
  const [drag, setDrag] = useState(false)
  const [mode, setMode] = useState<"link" | "note" | null>(null)
  const [text, setText] = useState("")
  const [textErr, setTextErr] = useState<string>()
  const [asking, setAsking] = useState<{ id: string; name: string; review: "rejected" | "info_requested" } | null>(null)
  const [reason, setReason] = useState("")
  const [reasonErr, setReasonErr] = useState<string>()

  // Fake upload (FR-MOB-05): no network, the bar just fills, then the item is attached locally.
  // `queue` is the source of truth so the interval can commit finished items without setState-in-effect.
  const queue = useRef<Upload[]>([])
  const addRef = useRef(onAdd)
  useEffect(() => {
    addRef.current = onAdd
  })
  const uploading = uploads.length > 0
  useEffect(() => {
    if (!uploading) return
    const id = window.setInterval(() => {
      const next = queue.current.map((x) => ({ ...x, pct: Math.min(100, x.pct + 20) }))
      const done = next.filter((x) => x.pct >= 100)
      queue.current = next.filter((x) => x.pct < 100)
      if (done.length) {
        done.forEach((x) => addRef.current({ kind: x.kind, name: x.name }))
        toast.success(done.length === 1 ? `${done[0].name} attached` : `${done.length} files attached`)
      }
      setUploads(queue.current)
    }, 140)
    return () => window.clearInterval(id)
  }, [uploading])

  function pickFiles(files: FileList | null) {
    if (!files?.length) return
    queue.current = [
      ...queue.current,
      ...Array.from(files).map((f) => ({ id: ++seq.current, name: f.name, kind: f.type.startsWith("image/") ? ("image" as const) : ("file" as const), pct: 0 })),
    ]
    setUploads(queue.current)
  }

  function addText(e: React.FormEvent) {
    e.preventDefault()
    const r = (mode === "link" ? linkSchema : noteSchema).safeParse(text)
    if (!r.success) return setTextErr(r.error.issues[0].message)
    onAdd({ kind: mode ?? "note", name: r.data })
    toast.success(mode === "link" ? "Link added" : "Note added")
    setText("")
    setTextErr(undefined)
    setMode(null)
  }

  function confirmReason(e: React.FormEvent) {
    e.preventDefault()
    const r = reasonSchema.safeParse(reason)
    if (!r.success || !asking) return setReasonErr(r.success ? undefined : r.error.issues[0].message)
    onReview(asking.id, asking.review, r.data)
    toast.success(asking.review === "rejected" ? "Evidence rejected" : "More information requested")
    closeAsk()
  }
  function closeAsk() {
    setAsking(null)
    setReason("")
    setReasonErr(undefined)
  }

  return (
    <section className="card" aria-labelledby="td-ev-h">
      <div className="card-head">
        <div>
          <h2 id="td-ev-h" className="td-h">Evidence</h2>
          <div className="sub">{required ? "Required before this task can be completed" : "Optional for this task"}</div>
        </div>
      </div>

      {canAdd && (
        <>
          <label
            className="ev-drop"
            data-drag={drag ? "" : undefined}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pickFiles(e.dataTransfer.files) }}
          >
            <input type="file" multiple className="sr-only" onChange={(e) => { pickFiles(e.target.files); e.target.value = "" }} />
            <strong>Drop files here or browse</strong>
            <span>Photos and documents. Uploads are simulated in this preview.</span>
          </label>
          <div className="ev-add">
            <button type="button" className="btn btn-outline" aria-pressed={mode === "link"} onClick={() => { setMode(mode === "link" ? null : "link"); setText(""); setTextErr(undefined) }}>Add link</button>
            <button type="button" className="btn btn-outline" aria-pressed={mode === "note"} onClick={() => { setMode(mode === "note" ? null : "note"); setText(""); setTextErr(undefined) }}>Add note</button>
          </div>
          {mode && (
            <form className="td-form" onSubmit={addText} noValidate>
              <Field label={mode === "link" ? "Link" : "Evidence note"} htmlFor="ev-text" error={textErr} required>
                {mode === "link" ? (
                  <Input id="ev-text" type="url" placeholder="https://" value={text} onChange={(e) => { setText(e.target.value); setTextErr(undefined) }} />
                ) : (
                  <Textarea id="ev-text" value={text} onChange={(e) => { setText(e.target.value); setTextErr(undefined) }} />
                )}
              </Field>
              <div className="td-form-foot"><button type="submit" className="btn btn-primary">{mode === "link" ? "Add link" : "Add note"}</button></div>
            </form>
          )}
        </>
      )}

      <ul className="ev-list">
        <AnimatePresence initial={false}>
          {uploads.map((u) => (
            <motion.li key={`up-${u.id}`} className="ev-item" {...listItem}>
              <div className="ev-main">
                <span className="dep-tag">{KIND[u.kind]}</span>
                <span className="ev-name">{u.name}</span>
                <span className="td-muted num">{u.pct}%</span>
              </div>
              <div suppressHydrationWarning className="progress ev-prog" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${u.pct}%` }} />
              </div>
            </motion.li>
          ))}
          {evidence.map((e) => (
            <motion.li key={e.id} className="ev-item" {...listItem}>
              <div className="ev-main">
                <span className="dep-tag">{KIND[e.kind]}</span>
                {e.kind === "link" ? (
                  <a className="ev-name ev-link" href={e.name} target="_blank" rel="noopener noreferrer">{e.name}</a>
                ) : (
                  <span className="ev-name">{e.name}</span>
                )}
                <StatusPill status={REVIEW[e.review]} />
              </div>
              <div className="td-tl-meta">{e.by} · <When iso={e.at} today={today} tzLabel={tzLabel} /></div>
              {e.reason && <p className="ev-reason">{e.reason}</p>}
              {canReview && (
                <div className="ev-review">
                  {e.review !== "accepted" && (
                    <button type="button" className="btn btn-outline ev-btn" onClick={() => { onReview(e.id, "accepted"); toast.success("Evidence accepted") }}>Accept</button>
                  )}
                  {e.review !== "rejected" && (
                    <button type="button" className="btn btn-outline ev-btn" onClick={() => setAsking({ id: e.id, name: e.name, review: "rejected" })}>Reject</button>
                  )}
                  {e.review !== "info_requested" && (
                    <button type="button" className="btn btn-outline ev-btn" onClick={() => setAsking({ id: e.id, name: e.name, review: "info_requested" })}>Request info</button>
                  )}
                </div>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {evidence.length === 0 && uploads.length === 0 && <p className="td-muted">No evidence attached yet.</p>}

      <Dialog open={!!asking} onOpenChange={(o) => !o && closeAsk()}>
        <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{asking?.review === "rejected" ? "Reject evidence" : "Request more information"}</DialogTitle>
            <DialogDescription>{asking ? `${asking.name}` : ""}</DialogDescription>
          </DialogHeader>
          <form className="od-form" onSubmit={confirmReason} noValidate>
            <Field label={asking?.review === "rejected" ? "Reason" : "Message to the assignee"} htmlFor="ev-reason" error={reasonErr} required>
              <Textarea id="ev-reason" value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr(undefined) }} />
            </Field>
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
              <button type="submit" className="btn btn-primary">{asking?.review === "rejected" ? "Reject" : "Send request"}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
