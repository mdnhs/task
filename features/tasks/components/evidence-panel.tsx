"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Camera, Link2, ListChecks, PenLine, StickyNote, Upload } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { DriveLink } from "@/components/drive-link"
import { Field } from "@/components/field"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import { isDriveUrl } from "@/lib/devices"
import { listItem } from "@/lib/motion"
import {
  EVIDENCE_STATE,
  EVIDENCE_TYPE_LABEL,
  describeRule,
  evidenceState,
  fileType,
  isValidItem,
  missingEvidence,
  normaliseRule,
  reviewerText,
  ruleError,
  uploadError,
  validCount,
} from "@/lib/task-evidence"
import type { Status } from "@/lib/types"
import type { NewEvidence } from "../mutations"
import type { Evidence, EvidenceRule, Person, Task } from "../types"
import { EvidenceRuleField } from "./evidence-rule-field"
import { SignatureDialog } from "./signature-pad"

const reviewPill = (e: Evidence): Status => {
  if (e.review === "accepted") return { tone: "ok", label: "Verified" }
  if (e.review === "rejected") return { tone: "bad", label: "Rejected" }
  if (e.review === "info_requested") return { tone: "warn", label: "Info requested" }
  return e.locked ? { tone: "info", label: "Awaiting verification" } : { tone: "mute", label: "Not submitted" }
}

type Upload = { id: number; name: string; kind: NewEvidence["kind"]; pct: number; source: "camera" | "upload"; url?: string; size: number }

const linkSchema = z.string().trim().min(1, "Paste the Drive link").refine(isDriveUrl, "Paste a Google Drive or Docs link (https://drive.google.com/…)")
const noteSchema = z.string().trim().min(1, "Write the note").max(500, "Keep it under 500 characters")
const reasonSchema = z.string().trim().min(3, "Give a short reason")

const ACCEPT: Partial<Record<EvidenceRule["types"][number], string>> = {
  image: "image/*",
  photo: "image/*",
  pdf: "application/pdf,.pdf",
  office: ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.csv,.rtf",
  video: "video/*",
}

/**
 * The add controls for the allowed types (FR-M1-41): camera photo, file upload, note, Drive link (work PC only, CR-02),
 * signature and the task checklist. Uploads are simulated: the bar fills, then the item is attached locally.
 */
export function EvidenceAdder({ task, me, driveAllowed, onAdd }: { task: Task; me: string; driveAllowed: boolean; onAdd(item: NewEvidence): void }) {
  const rule = task.evidenceRule
  const allowed = (t: EvidenceRule["types"][number]) => rule.mode === "none" || rule.types.includes(t)
  const fileTypes = (["image", "pdf", "office", "video"] as const).filter((t) => allowed(t))
  const accept = [...new Set(fileTypes.map((t) => ACCEPT[t]))].join(",")
  const [uploads, setUploads] = useState<Upload[]>([])
  const seq = useRef(0)
  const [drag, setDrag] = useState(false)
  const [mode, setMode] = useState<"drive" | "note" | null>(null)
  const [text, setText] = useState("")
  const [textErr, setTextErr] = useState<string>()
  const [signing, setSigning] = useState(false)

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
        done.forEach((x) => addRef.current({ kind: x.kind, name: x.name, source: x.source, url: x.url, size: x.size }))
        toast.success(done.length === 1 ? `${done[0].name} attached` : `${done.length} files attached`)
      }
      setUploads(queue.current)
    }, 140)
    return () => window.clearInterval(id)
  }, [uploading])

  function pickFiles(files: FileList | null, capture = false) {
    if (!files?.length) return
    const ok: Upload[] = []
    for (const f of Array.from(files)) {
      const kind = fileType(f.name, f.type, capture)
      const err = uploadError(rule, kind, f.size)
      if (err || !kind) {
        toast.error(`${f.name}: ${err}`)
        continue
      }
      const url = kind === "photo" || kind === "image" ? URL.createObjectURL(f) : undefined
      ok.push({ id: ++seq.current, name: f.name, kind, pct: 0, source: capture ? "camera" : "upload", url, size: f.size })
    }
    if (!ok.length) return
    queue.current = [...queue.current, ...ok]
    setUploads(queue.current)
  }

  function addText(e: React.FormEvent) {
    e.preventDefault()
    const r = (mode === "drive" ? linkSchema : noteSchema).safeParse(text)
    if (!r.success) return setTextErr(r.error.issues[0].message)
    if (mode === "drive" && !driveAllowed) return setTextErr("Google Drive links are available on your work PC")
    onAdd({ kind: mode ?? "note", name: r.data })
    toast.success(mode === "drive" ? "Drive link added" : "Note added")
    setText("")
    setTextErr(undefined)
    setMode(null)
  }

  const list = task.checklist ?? []
  const checklistDone = list.length > 0 && list.every((c) => c.done)
  const toggleMode = (m: "drive" | "note") => {
    setMode(mode === m ? null : m)
    setText("")
    setTextErr(undefined)
  }

  return (
    <div className="ev-adder">
      {fileTypes.length > 0 && (
        <label
          className="ev-drop"
          data-drag={drag ? "" : undefined}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pickFiles(e.dataTransfer.files) }}
        >
          <input type="file" multiple accept={accept} className="sr-only" onChange={(e) => { pickFiles(e.target.files); e.target.value = "" }} />
          <strong><Upload aria-hidden="true" />Drop files here or browse</strong>
          <span>{fileTypes.map((t) => EVIDENCE_TYPE_LABEL[t]).join(", ")}. Uploads are simulated in this preview.</span>
        </label>
      )}
      <div className="ev-add">
        {allowed("photo") && (
          <label className="btn btn-outline ev-cam">
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { pickFiles(e.target.files, true); e.target.value = "" }} />
            <Camera aria-hidden="true" />
            Take photo
          </label>
        )}
        {allowed("note") && <button type="button" className="btn btn-outline" aria-pressed={mode === "note"} onClick={() => toggleMode("note")}><StickyNote aria-hidden="true" />Add note</button>}
        {allowed("drive") && (
          <button type="button" className="btn btn-outline" aria-pressed={mode === "drive"} disabled={!driveAllowed} title={driveAllowed ? undefined : "Available on your work PC"} onClick={() => toggleMode("drive")}>
            <Link2 aria-hidden="true" />
            Drive link <span className="er-pc">· PC only</span>
          </button>
        )}
        {allowed("signature") && <button type="button" className="btn btn-outline" onClick={() => setSigning(true)}><PenLine aria-hidden="true" />Sign</button>}
        {allowed("checklist") && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={!checklistDone}
            title={checklistDone ? undefined : "Tick every checklist item first"}
            onClick={() => {
              onAdd({ kind: "checklist", name: `Checklist ${list.length}/${list.length} done` })
              toast.success("Checklist attached")
            }}
          >
            <ListChecks aria-hidden="true" />
            Attach checklist
          </button>
        )}
      </div>
      {mode && (
        <form className="td-form" onSubmit={addText} noValidate>
          <Field label={mode === "drive" ? "Drive link" : "Note"} htmlFor="ev-text" error={textErr} required>
            {mode === "drive" ? (
              <Input id="ev-text" type="url" placeholder="https://drive.google.com/…" value={text} onChange={(e) => { setText(e.target.value); setTextErr(undefined) }} />
            ) : (
              <Textarea id="ev-text" placeholder="e.g. Floor mopped, signs put back" value={text} onChange={(e) => { setText(e.target.value); setTextErr(undefined) }} />
            )}
          </Field>
          <div className="td-form-foot"><button type="submit" className="btn btn-primary">{mode === "drive" ? "Add link" : "Add note"}</button></div>
        </form>
      )}
      {uploads.length > 0 && (
        <ul className="ev-list">
          <AnimatePresence initial={false}>
            {uploads.map((u) => (
              <motion.li key={`up-${u.id}`} className="ev-item" {...listItem}>
                <div className="ev-main">
                  <span className="dep-tag">{EVIDENCE_TYPE_LABEL[u.kind]}</span>
                  <span className="ev-name">{u.name}</span>
                  <span className="td-muted num">{u.pct}%</span>
                </div>
                <div suppressHydrationWarning className="progress ev-prog" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${u.pct}%` }} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <SignatureDialog open={signing} onOpenChange={setSigning} signer={me} onSave={(url) => { onAdd({ kind: "signature", name: `Signature by ${me}`, url }); toast.success("Signature attached") }} />
    </div>
  )
}

function EvidenceItem({ e, task, canAdd, canVerify, driveAllowed, today, tzLabel, onRemove, onVerify, onReject }: {
  e: Evidence
  task: Task
  canAdd: boolean
  canVerify: boolean
  driveAllowed: boolean
  today: string
  tzLabel: string
  onRemove(id: string): void
  onVerify(id: string): void
  onReject(e: Evidence): void
}) {
  const waiting = e.locked && isValidItem(e) && e.review !== "accepted" && task.status === "submitted"
  return (
    <motion.li className="ev-item" {...listItem}>
      <div className="ev-main">
        {e.url && (e.kind === "photo" || e.kind === "image" || e.kind === "signature") && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob/data preview, not an optimisable asset
          <img className="ev-thumb" src={e.url} alt="" />
        )}
        <span className="dep-tag">{EVIDENCE_TYPE_LABEL[e.kind] ?? e.kind}</span>
        {e.kind === "drive" ? (
          <DriveLink allowed={driveAllowed} href={e.name} className="ev-name" />
        ) : (
          <span className={`ev-name${e.kind === "note" ? " ev-note" : ""}`}>{e.name}</span>
        )}
        <StatusPill status={reviewPill(e)} />
      </div>
      <div className="td-tl-meta">
        {e.by} · <When iso={e.at} today={today} tzLabel={tzLabel} />
        {e.kind === "photo" && (e.source === "camera" ? " · Taken with the camera" : " · From the gallery")}
        {(e.round ?? 1) > 1 && ` · Submission ${e.round}`}
        {e.locked && <span className="ev-lock"> · <Icon name="lock" /> Read-only</span>}
      </div>
      {e.reason && <p className="ev-reason">{e.reason}</p>}
      {(canVerify && waiting) || (canAdd && !e.locked) ? (
        <div className="ev-review">
          {canVerify && waiting && (
            <>
              <button type="button" className="btn btn-outline ev-btn" onClick={() => onVerify(e.id)}>Verify</button>
              <button type="button" className="btn btn-outline ev-btn" onClick={() => onReject(e)}>Reject</button>
            </>
          )}
          {canAdd && !e.locked && <button type="button" className="btn btn-outline ev-btn" onClick={() => onRemove(e.id)}>Remove</button>}
        </div>
      ) : null}
    </motion.li>
  )
}

/** Count line for Required rules, e.g. "1 of 2 attached · 1 more needed". */
function CountLine({ task }: { task: Task }) {
  const r = task.evidenceRule
  if (r.mode !== "required") return null
  const have = Math.min(validCount(task.evidence), r.min)
  const missing = missingEvidence(r, task.evidence)
  return (
    <div className="ev-count">
      <span className="num">{`${have} of ${r.min} attached${missing > 0 ? ` · ${missing} more needed` : ""}`}</span>
      <div className="progress ev-meter" role="progressbar" aria-label="Evidence attached" aria-valuenow={have} aria-valuemin={0} aria-valuemax={r.min}>
        <i style={{ transform: `scaleX(${have / r.min})` }} />
      </div>
    </div>
  )
}

export function EvidencePanel({
  task,
  people,
  me,
  canAdd,
  canVerify,
  canEditRule,
  driveAllowed,
  today,
  tzLabel,
  onAdd,
  onRemove,
  onReview,
  onRule,
}: {
  task: Task
  people: Person[]
  me: string
  /** The viewer may attach evidence (open task, write access, assignee side). */
  canAdd: boolean
  /** The viewer may verify / reject (FR-M1-45). */
  canVerify: boolean
  /** The creator or a manager may change the rule (FR-M1-40). */
  canEditRule: boolean
  /** Device policy decision for Google Drive, computed on the server (FR-M1-51). */
  driveAllowed: boolean
  today: string
  tzLabel: string
  onAdd(item: NewEvidence): void
  onRemove(id: string): void
  onReview(id: string, review: "accepted" | "rejected", reason?: string): void
  onRule(rule: EvidenceRule): void
}) {
  const rule = task.evidenceRule
  const [asking, setAsking] = useState<{ id: string; name: string } | null>(null)
  const [reason, setReason] = useState("")
  const [reasonErr, setReasonErr] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EvidenceRule>(rule)
  const [draftErr, setDraftErr] = useState<string>()
  const name = (id: string) => people.find((p) => p.id === id)?.name
  const creator = name(task.creator) ?? task.creator
  const state = evidenceState(rule, task.evidence, task.status)
  const current = task.evidence.filter(isValidItem)
  const earlier = task.evidence.filter((e) => !isValidItem(e))

  function confirmReason(e: React.FormEvent) {
    e.preventDefault()
    const r = reasonSchema.safeParse(reason)
    if (!r.success || !asking) return setReasonErr(r.success ? undefined : r.error.issues[0].message)
    onReview(asking.id, "rejected", r.data)
    toast.success("Evidence rejected. The task is reopened for the assignee")
    closeAsk()
  }
  function closeAsk() {
    setAsking(null)
    setReason("")
    setReasonErr(undefined)
  }
  function saveRule(e: React.FormEvent) {
    e.preventDefault()
    const err = ruleError(draft)
    if (err) return setDraftErr(err)
    onRule(normaliseRule(draft))
    toast.success("Evidence rule saved")
    setEditing(false)
  }

  return (
    <section className="card" aria-labelledby="td-ev-h">
      <div className="card-head">
        <div>
          <h2 id="td-ev-h" className="td-h">Evidence</h2>
          <div className="sub">{describeRule(rule)}</div>
        </div>
        <div className="ev-head-side">
          {state && <StatusPill status={EVIDENCE_STATE[state]} />}
          {canEditRule && (
            <button type="button" className="tpl-link" onClick={() => { setDraft(rule); setDraftErr(undefined); setEditing(true) }}>Edit rule</button>
          )}
        </div>
      </div>

      {rule.mode !== "none" && (
        <div className="ev-rule">
          {rule.instruction && <p className="ev-ins">{rule.instruction}</p>}
          <p className="td-muted">{reviewerText(rule, creator, name)}</p>
          <CountLine task={task} />
        </div>
      )}
      {rule.mode === "none" && task.evidence.length === 0 && <p className="td-muted">Not needed for this task. It closes with one tap.</p>}

      {canAdd && rule.mode !== "none" && <EvidenceAdder task={task} me={me} driveAllowed={driveAllowed} onAdd={onAdd} />}

      {current.length > 0 && (
        <ul className="ev-list">
          <AnimatePresence initial={false}>
            {current.map((e) => (
              <EvidenceItem
                key={e.id}
                e={e}
                task={task}
                canAdd={canAdd}
                canVerify={canVerify}
                driveAllowed={driveAllowed}
                today={today}
                tzLabel={tzLabel}
                onRemove={onRemove}
                onVerify={(id) => { onReview(id, "accepted"); toast.success("Evidence verified") }}
                onReject={(it) => setAsking({ id: it.id, name: it.name })}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {rule.mode !== "none" && current.length === 0 && <p className="td-muted ev-empty">No evidence attached yet.</p>}

      {earlier.length > 0 && (
        <details className="ev-earlier">
          <summary>Earlier versions ({earlier.length})</summary>
          <ul className="ev-list">
            {earlier.map((e) => (
              <EvidenceItem key={e.id} e={e} task={task} canAdd={false} canVerify={false} driveAllowed={driveAllowed} today={today} tzLabel={tzLabel} onRemove={() => {}} onVerify={() => {}} onReject={() => {}} />
            ))}
          </ul>
        </details>
      )}

      <Dialog open={!!asking} onOpenChange={(o) => !o && closeAsk()}>
        <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reject evidence</DialogTitle>
            <DialogDescription>{asking?.name}. The task reopens for the assignee with your comment.</DialogDescription>
          </DialogHeader>
          <form className="od-form" onSubmit={confirmReason} noValidate>
            <Field label="Reason" htmlFor="ev-reason" error={reasonErr} required>
              <Textarea id="ev-reason" placeholder="e.g. The photo is too dark" value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr(undefined) }} />
            </Field>
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
              <button type="submit" className="btn btn-primary">Reject</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Evidence rule</DialogTitle>
            <DialogDescription>What {task.ref} needs before it counts as done.</DialogDescription>
          </DialogHeader>
          <form className="od-form" onSubmit={saveRule} noValidate>
            <EvidenceRuleField id="er-edit" value={draft} onChange={(r) => { setDraft(r); setDraftErr(undefined) }} people={people} error={draftErr} />
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
              <button type="submit" className="btn btn-primary">Save rule</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * FR-M1-43: pressing Complete on a Required task below its minimum opens this upload step. Complete stays disabled
 * until the minimum is met, then runs the normal complete (Completed, or Awaiting verification).
 */
export function EvidenceStepDialog({ open, onOpenChange, task, me, driveAllowed, onAdd, onComplete }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  me: string
  driveAllowed: boolean
  onAdd(item: NewEvidence): void
  onComplete(): void
}) {
  const missing = missingEvidence(task.evidenceRule, task.evidence)
  const items = task.evidence.filter((e) => isValidItem(e) && !e.locked)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add evidence to complete</DialogTitle>
          <DialogDescription>{task.evidenceRule.instruction || describeRule(task.evidenceRule)}</DialogDescription>
        </DialogHeader>
        <div className="od-form">
          <CountLine task={task} />
          <EvidenceAdder task={task} me={me} driveAllowed={driveAllowed} onAdd={onAdd} />
          {items.length > 0 && (
            <ul className="ev-list ev-step-list">
              {items.map((e) => (
                <li key={e.id} className="ev-item">
                  <div className="ev-main"><span className="dep-tag">{EVIDENCE_TYPE_LABEL[e.kind]}</span><span className="ev-name">{e.name}</span></div>
                </li>
              ))}
            </ul>
          )}
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Later</DialogClose>
            <button type="button" className="btn btn-primary" disabled={missing > 0} onClick={() => { onComplete(); onOpenChange(false) }}>
              {missing > 0 ? `${missing} more needed` : "Complete"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
