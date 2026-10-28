"use client"

import { useState } from "react"
import { RotateCw, TriangleAlert } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { When } from "@/components/when"
import type { Gate } from "../logic"
import { LOW_CONFIDENCE } from "../types"
import type { VoiceMessage } from "../types"

// Voice-note transcript (FR-WA-03/05/07). Machine-generated until a user confirms or edits it; poor quality and failures say so.
export function Transcript({
  msg,
  gate,
  transcribe,
  today,
  tzLabel,
  onConfirm,
  onRetry,
}: {
  msg: VoiceMessage
  /** Confirm / edit / retry permission. */
  gate: Gate
  /** Whether the voice transcription flow is on for this tenant. */
  transcribe: Gate
  today: string
  tzLabel: string
  onConfirm(text: string): void
  onRetry(): void
}) {
  const t = msg.transcript
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (!msg.supported || t.state === "unsupported") return null
  if (!transcribe.ok) return <p className="wa-tr-note">{transcribe.reason}</p>

  if (t.state === "transcribing")
    return (
      <p className="wa-tr-note wa-tr-busy" role="status">
        <span className="wa-dots" aria-hidden="true"><i /><i /><i /></span>
        Transcribing voice note…
      </p>
    )

  if (t.state === "failed")
    return (
      <div className="wa-tr wa-tr-failed" role="alert">
        <p className="wa-tr-warn">
          <TriangleAlert aria-hidden="true" />
          <span>Transcription failed. {t.error} Listen to the recording, or try again.</span>
        </p>
        {gate.ok && (
          <button type="button" className="wa-tr-btn" onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            Retry transcription
          </button>
        )}
      </div>
    )

  const confirmed = !!t.confirmedBy
  const low = !confirmed && (t.confidence ?? 1) < LOW_CONFIDENCE
  return (
    <div className="wa-tr">
      {confirmed ? (
        <span className="wa-badge ok">
          {t.edited ? "Edited and confirmed" : "Confirmed"} by {t.confirmedBy}
          {t.confirmedAt && <> · <When iso={t.confirmedAt} today={today} tzLabel={tzLabel} /></>}
        </span>
      ) : (
        <span className="wa-badge warn">Machine-generated — not confirmed</span>
      )}
      {low && (
        <p className="wa-tr-warn">
          <TriangleAlert aria-hidden="true" />
          <span>Poor audio quality ({Math.round((t.confidence ?? 0) * 100)}% confidence). Check it against the recording before you confirm.</span>
        </p>
      )}
      {editing ? (
        <form
          className="wa-tr-edit"
          onSubmit={(e) => {
            e.preventDefault()
            onConfirm(draft)
            setEditing(false)
          }}
        >
          <Textarea aria-label="Edit transcript" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="wa-tr-actions">
            <button type="button" className="wa-tr-btn" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="wa-tr-btn primary" disabled={!draft.trim()}>Save and confirm</button>
          </div>
        </form>
      ) : (
        <>
          <p className="wa-tr-text">{t.text}</p>
          {!confirmed && gate.ok && (
            <div className="wa-tr-actions">
              <button type="button" className="wa-tr-btn" onClick={() => { setDraft(t.text ?? ""); setEditing(true) }}>Edit</button>
              <button type="button" className="wa-tr-btn primary" onClick={() => onConfirm(t.text ?? "")}>Confirm</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
