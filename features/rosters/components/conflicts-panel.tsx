"use client"

import { Info, TriangleAlert, X } from "lucide-react"

import { formatDate } from "@/lib/dates"
import type { RepeatConflict } from "@/lib/roster-repeat"
import type { RosterShift } from "../types"

// What a repeat or template apply changed (FR-RS-26/28, D10): open shifts (a rule stopped the person) and info (public holiday, person kept).
// Each row opens its shift; assigning someone to an open shift is done from there.
export function ConflictsPanel({ conflicts, shiftOf, nameOf, onOpen, onDismiss }: {
  conflicts: RepeatConflict[]
  shiftOf(id: string): RosterShift | undefined
  nameOf(id: string | null): string
  onOpen(shiftId: string): void
  onDismiss(): void
}) {
  if (!conflicts.length) return null
  const open = conflicts.filter((c) => c.open).length
  return (
    <section className="card ros-panel" aria-label="Repeat conflicts">
      <div className="ros-panel-head">
        <h2>Repeat conflicts</h2>
        <span className="ros-sum num">{open} open{conflicts.length - open > 0 ? ` · ${conflicts.length - open} info` : ""}</span>
        <button type="button" className="ros-nav-btn ros-panel-x" aria-label="Dismiss conflicts" onClick={onDismiss}><X aria-hidden="true" /></button>
      </div>
      <ul className="ros-viol">
        {conflicts.map((c) => {
          const s = shiftOf(c.shiftId)
          return (
            <li key={`${c.shiftId}-${c.reason}`} className="ros-viol-row" data-kind={c.open ? "block" : "warn"}>
              {c.open ? <TriangleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
              <span>
                <b>{nameOf(c.personId)}</b> {c.message}
                {s && <> · <button type="button" className="ros-req-btn ros-conf-link num" onClick={() => onOpen(c.shiftId)}>{formatDate(s.date)} {s.start}–{s.end}{c.open ? ", open shift" : ""}</button></>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
