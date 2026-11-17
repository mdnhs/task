"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { VoiceNotePlayer, VoiceRecorder, type VoiceDraft } from "@/components/voice-note"
import { When } from "@/components/when"
import { ApiError, userMessage } from "@/lib/api/problem"
import { formatDate } from "@/lib/dates"
import { playUrl } from "../client"
import type { Task } from "../types"

/** 3 MiB, the API's cap on a voice file (D21). */
export const VOICE_MAX_BYTES = 3 * 1024 * 1024

export type Play = { id: string; by: string; at: string }

/**
 * Voice instructions on the task page (D21). Playing: every click makes ONE fresh path on our own origin (`playUrl`), which the API answers with a 60 s redirect and logs;
 * nothing is cached or stored here. Setting, replacing and removing are for the creator or a manager (`canManage`); "Who played" is for managers of the task only (`canSeePlays`).
 * A recording over 120 s cannot be made (the recorder stops itself), is refused here before any upload, and is refused by the API too (422 voice_too_long).
 */
export function VoiceCard({ task, canManage, canSeePlays, today, tzLabel, onSet, onClear, loadPlays }: {
  task: Task
  canManage: boolean
  canSeePlays: boolean
  today: string
  tzLabel: string
  onSet(blob: Blob, durationSec: number): Promise<boolean>
  onClear(): Promise<boolean>
  loadPlays(): Promise<Play[] | null>
}) {
  const note = task.voiceNote
  const [recording, setRecording] = useState(false)
  const [draft, setDraft] = useState<VoiceDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [plays, setPlays] = useState<Play[] | null>(null)
  const [removing, setRemoving] = useState(false)
  const nonce = useRef(0)
  if (!note && !canManage) return null

  /** The player could not load: read the API's answer (a manual-redirect probe, no second play is logged for a refusal) and say why in short copy. */
  async function explain(path: string) {
    try {
      const res = await fetch(path, { redirect: "manual", credentials: "same-origin" })
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return void toast.error("The voice note could not be played. Try again.")
      toast.error(userMessage(await ApiError.fromResponse(res)).text)
    } catch {
      toast.error("The voice note could not be played. Try again.")
    }
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      const blob = await (await fetch(draft.url)).blob()
      if (blob.size > VOICE_MAX_BYTES) return void toast.error("That recording is too large (3 MB at most)")
      if (await onSet(blob, draft.durationSec)) {
        URL.revokeObjectURL(draft.url)
        setDraft(null)
        setRecording(false)
        toast.success("Voice instructions saved")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="td-voice" role="group" aria-labelledby="td-voice-h">
      <div className="td-voice-h">
        <span id="td-voice-h">Voice instructions</span>
        {note && <span className="td-voice-m">Recorded by {note.recordedBy} · {formatDate(note.recordedAt)}</span>}
      </div>
      {note && <VoiceNotePlayer fresh={() => playUrl(task.id ?? "", `${Date.now()}-${++nonce.current}`)} onFail={(p) => void explain(p)} durationSec={note.durationSec} label="voice instructions" />}
      {(canManage || canSeePlays) && !recording && (
        <div className="vn-row">
          {canManage && <button type="button" className="vn-link" onClick={() => setRecording(true)}>{note ? "Replace" : "Add voice instructions"}</button>}
          {canManage && note && <button type="button" className="vn-link bad" onClick={() => setRemoving(true)}>Remove</button>}
          {canSeePlays && note && (
            <button type="button" className="vn-link" onClick={async () => setPlays(plays ? null : (await loadPlays()) ?? [])}>{plays ? "Hide plays" : "Who played"}</button>
          )}
        </div>
      )}
      {plays && (
        <ul className="td-notes">
          {plays.length === 0 && <li className="td-muted">Nobody has played it yet.</li>}
          {plays.map((p) => <li key={p.id}><span className="td-tl-meta">{p.by} · <When iso={p.at} today={today} tzLabel={tzLabel} /></span></li>)}
        </ul>
      )}
      {recording && (
        <div className="vn-preview">
          <VoiceRecorder id="td-voice-rec" value={draft} onChange={setDraft} hint="Up to 2 min" />
          <div className="vn-row">
            {draft && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save voice note</button>}
            <button type="button" className="vn-link" onClick={() => { if (draft) URL.revokeObjectURL(draft.url); setDraft(null); setRecording(false) }}>Cancel</button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the voice instructions?"
        text="The recording is deleted for everyone on this task."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (await onClear()) toast.success("Voice instructions removed")
        }}
      />
    </div>
  )
}
