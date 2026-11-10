"use client"

import { useState } from "react"

import { formatDate, formatTime } from "@/lib/dates"
import type { HistoryEntry, RosterShift } from "../types"

const PAGE = 20
const ACTION: Record<string, string> = {
  publish: "Published week",
  "edit-published": "Edited published shift",
  "change-approved": "Approved change request",
  "shift.added": "Added shift",
  "shift.edited": "Edited shift",
  "shift.moved": "Moved shift",
  "shift.removed": "Removed shift",
  "claim.approved": "Approved open shift claim",
  "swap.approved": "Approved swap",
  repeat: "Repeated week",
  "template-apply": "Applied week template",
}

// Read-only change history (FR-RS audit trail), newest first, 20 at a time.
export function HistoryPanel({ entries, shiftOf, nameOf }: { entries: HistoryEntry[]; shiftOf(id: string): RosterShift | undefined; nameOf(id: string | null): string }) {
  const [shown, setShown] = useState(PAGE)
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at))
  if (!sorted.length) return null
  return (
    <section className="card ros-panel" aria-label="Roster history">
      <div className="ros-panel-head">
        <h2>History</h2>
        <span className="ros-sum num">{sorted.length}</span>
      </div>
      <ul className="ros-hist">
        {sorted.slice(0, shown).map((h) => {
          const s = h.shiftId ? (shiftOf(h.shiftId) ?? (h.action === "shift.removed" ? (h.before as RosterShift) : undefined)) : undefined
          return (
            <li key={h.id} className="ros-hist-row">
              <span className="ros-who">{ACTION[h.action] ?? h.action}{s ? ` · ${nameOf(s.personId)}, ${formatDate(s.date)}` : ""}</span>
              <span className="ros-time num">{nameOf(h.by)} · {formatDate(h.at.slice(0, 10))} {formatTime(h.at)}</span>
              {h.reason && <span className="ros-role">{h.reason}</span>}
            </li>
          )
        })}
      </ul>
      {sorted.length > shown && (
        <button type="button" className="btn btn-outline ros-more" onClick={() => setShown((n) => n + PAGE)}>Show more</button>
      )}
    </section>
  )
}
