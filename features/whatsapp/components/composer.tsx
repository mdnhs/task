"use client"

import { useState } from "react"
import { Lock, SendHorizontal } from "lucide-react"

import type { Gate } from "../logic"

// Reply box. FR-WA-04: sending needs write permission and an enabled outbound flow; otherwise it is disabled with the reason.
export function Composer({ gate, contact, onSend }: { gate: Gate; contact: string; onSend(text: string): void }) {
  const [text, setText] = useState("")
  const off = !gate.ok
  const submit = () => {
    if (off || !text.trim()) return
    onSend(text)
    setText("")
  }
  return (
    <form
      className="wa-composer"
      data-disabled={off || undefined}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="wa-compose-row">
        <textarea
          className="wa-input"
          rows={1}
          value={text}
          disabled={off}
          placeholder={off ? "Replies are turned off" : `Reply to ${contact}`}
          aria-label={`Reply to ${contact}`}
          aria-describedby={off ? "wa-compose-why" : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" className="wa-send" disabled={off || !text.trim()} aria-label="Send reply">
          <SendHorizontal aria-hidden="true" />
        </button>
      </div>
      {off && (
        <p id="wa-compose-why" className="wa-compose-why">
          <Lock aria-hidden="true" />
          {gate.reason}
        </p>
      )}
    </form>
  )
}
