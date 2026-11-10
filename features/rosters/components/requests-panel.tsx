"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/dates"
import type { ChangeRequest, RosterShift } from "../types"

const FIELD: Record<string, string> = { start: "Start", end: "End", date: "Day", personId: "Person", templateId: "Shift" }

// Open change requests on published weeks (FR-RS-36/37). Only roles that approve see this; approving applies the change and asks the person to confirm again.
export function RequestsPanel({ requests, shiftOf, nameOf, onDecide }: {
  requests: ChangeRequest[]
  shiftOf(id: string): RosterShift | undefined
  nameOf(id: string | null): string
  onDecide(id: string, approve: boolean, note: string | null): void
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const open = requests.filter((r) => r.status === "open")
  if (!open.length) return null
  const show = (k: string, v: unknown) => (k === "personId" ? nameOf((v as string | null) ?? null) : k === "date" ? formatDate(String(v)) : String(v))
  return (
    <section className="card ros-panel" aria-label="Change requests">
      <div className="ros-panel-head">
        <h2>Change requests</h2>
        <span className="ros-sum num">{open.length} open</span>
      </div>
      <ul className="ros-req-list">
        {open.map((r) => {
          const s = shiftOf(r.shiftId)
          return (
            <li key={r.id} className="ros-req">
              <div className="ros-req-main">
                <span className="ros-who">{nameOf(r.by)} · {s ? `${nameOf(s.personId)}, ${formatDate(s.date)} ${s.start}–${s.end}` : "Shift removed"}</span>
                <span className="ros-time num">
                  {Object.entries(r.patch).map(([k, v]) => `${FIELD[k] ?? k}: ${s ? show(k, s[k as keyof RosterShift]) + " → " : ""}${show(k, v)}`).join(" · ")}
                </span>
                <span className="ros-role">{r.why}</span>
              </div>
              <Input className="ros-req-note" aria-label="Note" placeholder="Note (optional)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
              <div className="ros-req-act">
                <button type="button" className="btn btn-outline" onClick={() => onDecide(r.id, false, notes[r.id] ?? null)}><X aria-hidden="true" />Reject</button>
                <button type="button" className="btn btn-primary" disabled={!s} onClick={() => onDecide(r.id, true, notes[r.id] ?? null)}><Check aria-hidden="true" />Approve</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
