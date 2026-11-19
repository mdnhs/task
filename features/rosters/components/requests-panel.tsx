"use client"

import { AnimatePresence, motion } from "motion/react"
import { listItem } from "@/lib/motion"
import { useState } from "react"

import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/dates"
import { patchLines } from "../publishing"
import type { ApiChangeRequest, WeekShift } from "../types"

// Open change requests on published weeks (FR-RS-36/37). The API cuts the list to the caller's sites. Only the office decides (a supervisor sees their own requests waiting). Approving applies the
// change and asks the person to confirm again; one that breaks a new rule asks for a reason first (the page opens the reason dialog on the API's 422 rule_blocked).
export function RequestsPanel({ requests, shiftOf, nameOf, canDecide, busy, onDecide }: {
  requests: ApiChangeRequest[]
  shiftOf(id: string): WeekShift | undefined
  nameOf(id: string | null): string
  /** An office role: Approve and Reject are shown. */
  canDecide: boolean
  /** Request ids with a decision on its way: their buttons are off, so one click is one request. */
  busy: ReadonlySet<string>
  onDecide(r: ApiChangeRequest, decision: "approve" | "reject", note: string): void
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const open = requests.filter((r) => r.status === "requested")
  if (!open.length) return null
  return (
    <section className="card ros-panel" aria-label="Change requests">
      <div className="ros-panel-head">
        <h2>Change requests</h2>
        <span className="ros-sum num">{open.length} open</span>
      </div>
      <ul className="ros-req-list">
        <AnimatePresence initial={false}>
          {open.map((r) => {
            const s = shiftOf(r.shiftId)
            const working = busy.has(r.id)
            return (
              <motion.li key={r.id} className="ros-req" {...listItem}>
                <div className="ros-req-main">
                  <span className="ros-who">{nameOf(r.requestedBy)} · {s ? `${nameOf(s.personId)}, ${formatDate(s.date)} ${s.start}–${s.end}` : "Shift not in view"}</span>
                  <span className="ros-time num">{patchLines(r.patch, s, nameOf).join(" · ")}</span>
                  <span className="ros-role">{r.reason}</span>
                </div>
                {canDecide ? (
                  <>
                    <Input className="ros-req-note" aria-label="Note" maxLength={2000} placeholder="Note (optional)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                    <div className="ros-req-act">
                      <button type="button" className="btn btn-outline" disabled={working} onClick={() => onDecide(r, "reject", notes[r.id] ?? "")}><Icon name="close" size={24} />Reject</button>
                      <button type="button" className="btn btn-primary" disabled={working} onClick={() => onDecide(r, "approve", notes[r.id] ?? "")}><Icon name="check" size={24} />Approve</button>
                    </div>
                  </>
                ) : (
                  <span className="ros-role"><Icon name="hourglass" className="ros-os-i" size={24} />The office decides</span>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </section>
  )
}
