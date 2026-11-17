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
import { userMessage } from "@/lib/api/problem"
import { canOpenEvidence, evidencePath, openEvidence } from "../client"
import { canVerifyItem, countable, evState, ruleView, type Viewer } from "../evidence-view"
import {
  EVIDENCE_STATE,
  EVIDENCE_TYPE_LABEL,
  describeRule,
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
import type { Evidence, EvidenceRule, Person, Task } from "../types"
import { EvidenceRuleField } from "./evidence-rule-field"
import { SignatureDialog } from "./signature-pad"

const reviewPill = (e: Evidence): Status => {
  // A file item is only evidence once the scan says clean (D10): until then it is "Scanning", and an infected one is refused (the API also rejects it with a reason).
  if (e.fileStatus === "infected") return { tone: "bad", label: "Infected" }
  if (e.fileStatus === "pending") return { tone: "info", label: "Scanning" }
  if (e.fileStatus === "deleted") return { tone: "mute", label: "Removed" }
  if (e.review === "accepted") return { tone: "ok", label: "Verified" }
  if (e.review === "rejected") return { tone: "bad", label: "Rejected" }
  if (e.review === "info_requested") return { tone: "warn", label: "Info requested" }
  return e.locked ? { tone: "info", label: "Awaiting verification" } : { tone: "mute", label: "Not submitted" }
}

type FileKind = "photo" | "image" | "pdf" | "office" | "video" | "signature"
type Upload = { id: number; name: string; phase: "uploading" | "scanning" }

/** What the adders do (each resolves true only when the API accepted it): the panel owns no state, so nothing is shown as added before the server says so. */
export type EvidenceAdds = {
  file(file: File, kind: FileKind, source: "camera" | "upload", onScanning: () => void): Promise<boolean>
  text(kind: "note" | "drive", text: string): Promise<boolean>
  checklist(): Promise<boolean>
}

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
 * The add controls for the allowed types (FR-M1-41): camera photo, file upload, note, Drive link (work PC only, CR-02), signature and the task checklist.
 * A file goes up to storage, then is scanned: the row says "Uploading", then "Scanning", and becomes evidence only when the API lists it (clean).
 */
export function EvidenceAdder({ task, me, driveAllowed, adds }: { task: Task; me: string; driveAllowed: boolean; adds: EvidenceAdds }) {
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
  const [busy, setBusy] = useState(false)

  async function send(f: File, kind: FileKind, source: "camera" | "upload") {
    const id = ++seq.current
    setUploads((u) => [...u, { id, name: f.name, phase: "uploading" }])
    try {
      const ok = await adds.file(f, kind, source, () => setUploads((u) => u.map((x) => (x.id === id ? { ...x, phase: "scanning" } : x))))
      if (ok) toast.success(`${f.name} attached`)
    } finally {
      setUploads((u) => u.filter((x) => x.id !== id))
    }
  }

  function pickFiles(files: FileList | null, capture = false) {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      const kind = fileType(f.name, f.type, capture)
      const err = uploadError(rule, kind, f.size)
      if (err || !kind) {
        toast.error(`${f.name}: ${err}`)
        continue
      }
      void send(f, kind as FileKind, capture ? "camera" : "upload")
    }
  }

  async function addText(e: React.FormEvent) {
    e.preventDefault()
    const r = (mode === "drive" ? linkSchema : noteSchema).safeParse(text)
    if (!r.success) return setTextErr(r.error.issues[0].message)
    if (mode === "drive" && !driveAllowed) return setTextErr("Google Drive links are available on your work PC")
    setBusy(true)
    const ok = await adds.text(mode ?? "note", r.data)
    setBusy(false)
    if (!ok) return
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
          <span>{fileTypes.map((t) => EVIDENCE_TYPE_LABEL[t]).join(", ")}. Files are scanned before they count.</span>
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
            disabled={!checklistDone || busy}
            title={checklistDone ? undefined : "Tick every checklist item first"}
            onClick={async () => {
              setBusy(true)
              const ok = await adds.checklist()
              setBusy(false)
              if (ok) toast.success("Checklist attached")
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
          <div className="td-form-foot"><button type="submit" className="btn btn-primary" disabled={busy}>{mode === "drive" ? "Add link" : "Add note"}</button></div>
        </form>
      )}
      {uploads.length > 0 && (
        <ul className="ev-list">
          <AnimatePresence initial={false}>
            {uploads.map((u) => (
              <motion.li key={`up-${u.id}`} className="ev-item" {...listItem}>
                <div className="ev-main">
                  <span className="dep-tag">{u.phase === "scanning" ? "Scanning" : "Uploading"}</span>
                  <span className="ev-name">{u.name}</span>
                </div>
                <div suppressHydrationWarning className="progress ev-prog" role="progressbar" aria-label={`${u.phase === "scanning" ? "Scanning" : "Uploading"} ${u.name}`} aria-valuenow={u.phase === "scanning" ? 70 : 30} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: u.phase === "scanning" ? "70%" : "30%" }} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <SignatureDialog
        open={signing}
        onOpenChange={setSigning}
        signer={me}
        onSave={async (dataUrl) => {
          const blob = await (await fetch(dataUrl)).blob()
          void send(new File([blob], `signature-${me.replace(/\W+/g, "-")}.png`, { type: blob.type || "image/png" }), "signature", "upload")
        }}
      />
    </div>
  )
}

/** The thumbnail of a clean image. The path (fresh nonce per mount) is set in the browser after mount, so it is never in server HTML, and no request is made for a scanning, infected or removed item. */
function Thumb({ taskId, evidenceId }: { taskId: string; evidenceId: string }) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void Promise.resolve().then(() => setSrc(evidencePath(taskId, evidenceId, `${Date.now()}-${Math.random().toString(36).slice(2)}`)))
  }, [taskId, evidenceId])
  if (!src || failed) return null
  // eslint-disable-next-line @next/next/no-img-element -- a same-origin redirect to a 60 s presigned URL, never optimisable or cacheable
  return <img className="ev-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}

async function openFile(taskId: string, evidenceId: string) {
  const r = await openEvidence(taskId, evidenceId, { fetch: (...a) => fetch(...a), open: (u) => void window.open(u, "_blank", "noopener"), nonce: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  if (!r.ok) toast.error(userMessage(r.error).text)
}
function EvidenceItem({ e, task, canAdd, canVerify, driveAllowed, today, tzLabel, onRemove, onVerify, onReject }: {
  e: Evidence
  task: Task
  canAdd: boolean
  /** Already includes "not the uploader of this item" (canVerifyItem). */
  canVerify: boolean
  driveAllowed: boolean
  today: string
  tzLabel: string
  onRemove(id: string): void
  onVerify(id: string): void
  onReject(e: Evidence): void
}) {
  const waiting = e.locked && isValidItem(e) && e.review !== "accepted" && task.status === "submitted" && (!e.fileId || e.fileStatus === "clean")
  return (
    <motion.li className="ev-item" {...listItem}>
      <div className="ev-main">
        {task.id && canOpenEvidence(e) && (e.kind === "photo" || e.kind === "image" || e.kind === "signature") && <Thumb taskId={task.id} evidenceId={e.id} />}
        <span className="dep-tag">{EVIDENCE_TYPE_LABEL[e.kind] ?? e.kind}</span>
        {e.kind === "drive" ? (
          // The API withholds a Drive link off the company PC (the name is then not a link): shown as is, never rebuilt here.
          <DriveLink allowed={driveAllowed && isDriveUrl(e.name)} href={e.name} className="ev-name" />
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
      {(canVerify && waiting) || (canAdd && !e.locked) || (task.id && canOpenEvidence(e)) ? (
        <div className="ev-review">
          {task.id && canOpenEvidence(e) && <button type="button" className="btn btn-outline ev-btn" onClick={() => void openFile(task.id!, e.id)}>Open</button>}
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
  adds,
  onRemove,
  onReview,
  onRule,
  viewer,
}: {
  task: Task
  people: Person[]
  me: string
  /** Who is looking: an item they uploaded is never theirs to verify (D8). */
  viewer: Viewer
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
  adds: EvidenceAdds
  onRemove(id: string): Promise<boolean>
  onReview(id: string, review: "accepted" | "rejected", reason?: string): Promise<boolean>
  onRule(rule: EvidenceRule): Promise<boolean>
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
  const state = evState(task)
  const current = task.evidence.filter(isValidItem)
  const earlier = task.evidence.filter((e) => !isValidItem(e))

  async function confirmReason(e: React.FormEvent) {
    e.preventDefault()
    const r = reasonSchema.safeParse(reason)
    if (!r.success || !asking) return setReasonErr(r.success ? undefined : r.error.issues[0].message)
    if (await onReview(asking.id, "rejected", r.data)) {
      toast.success("Evidence rejected. The task is reopened for the assignee")
      closeAsk()
    }
  }
  function closeAsk() {
    setAsking(null)
    setReason("")
    setReasonErr(undefined)
  }
  async function saveRule(e: React.FormEvent) {
    e.preventDefault()
    const err = ruleError(draft)
    if (err) return setDraftErr(err)
    if (await onRule(normaliseRule(draft))) {
      toast.success("Evidence rule saved")
      setEditing(false)
    }
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
          <CountLine task={ruleView(task)} />
        </div>
      )}
      {rule.mode === "none" && task.evidence.length === 0 && <p className="td-muted">Not needed for this task. It closes with one tap.</p>}

      {canAdd && rule.mode !== "none" && <EvidenceAdder task={task} me={me} driveAllowed={driveAllowed} adds={adds} />}

      {current.length > 0 && (
        <ul className="ev-list">
          <AnimatePresence initial={false}>
            {current.map((e) => (
              <EvidenceItem
                key={e.id}
                e={e}
                task={task}
                canAdd={canAdd}
                canVerify={canVerify && canVerifyItem(e, viewer)}
                driveAllowed={driveAllowed}
                today={today}
                tzLabel={tzLabel}
                onRemove={(id) => void onRemove(id)}
                onVerify={async (id) => { if (await onReview(id, "accepted")) toast.success("Evidence verified") }}
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
export function EvidenceStepDialog({ open, onOpenChange, task, me, driveAllowed, adds, onComplete }: {
  open: boolean
  onOpenChange(o: boolean): void
  task: Task
  me: string
  driveAllowed: boolean
  adds: EvidenceAdds
  onComplete(): Promise<boolean>
}) {
  const missing = missingEvidence(task.evidenceRule, countable(task.evidence))
  const items = task.evidence.filter((e) => isValidItem(e) && !e.locked)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add evidence to complete</DialogTitle>
          <DialogDescription>{task.evidenceRule.instruction || describeRule(task.evidenceRule)}</DialogDescription>
        </DialogHeader>
        <div className="od-form">
          <CountLine task={ruleView(task)} />
          <EvidenceAdder task={task} me={me} driveAllowed={driveAllowed} adds={adds} />
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
            <button type="button" className="btn btn-primary" disabled={missing > 0} onClick={async () => { if (await onComplete()) onOpenChange(false) }}>
              {missing > 0 ? `${missing} more needed` : "Complete"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
