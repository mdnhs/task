"use client"

import { AnimatePresence, motion } from "motion/react"

import { Icon } from "@/components/icon"
import { listItem } from "@/lib/motion"
import type { ViolationLine } from "../view"

// What the API said about the shifts (the warnings that came back with an edit, a refused edit, or a "Check rules"): each line names the person and the shifts (AC-RS-04 front).
// Blocks first. A shift is a button that opens it. `override` is only offered when the rule blocks and the caller's level may go over it (the API decides; a 403 says "office only").
export function ViolationsPanel({ lines, needsOffice, onOpen, onOverride, onDismiss }: {
  lines: ViolationLine[]
  /** A refused edit waits for an override and only the office may give it. */
  needsOffice?: boolean
  onOpen(shiftId: string): void
  /** Set when a refused edit can be retried with a reason. */
  onOverride?(): void
  onDismiss(): void
}) {
  if (!lines.length) return null
  const blocks = lines.filter((l) => l.severity === "block").length
  return (
    <section className="card ros-panel" aria-label="Rule warnings">
      <div className="ros-panel-head">
        <h2>Rules</h2>
        <span className="ros-sum num" data-short={blocks > 0 || undefined}>{blocks > 0 ? `${blocks} blocking` : ""}{blocks > 0 && lines.length - blocks > 0 ? " · " : ""}{lines.length - blocks > 0 ? `${lines.length - blocks} warning${lines.length - blocks === 1 ? "" : "s"}` : ""}</span>
        <button type="button" className="ros-nav-btn ros-panel-x" aria-label="Dismiss rules" onClick={onDismiss}><Icon name="close" size={24} /></button>
      </div>
      <ul className="ros-viol">
        <AnimatePresence initial={false}>
          {lines.map((l) => (
            <motion.li key={l.key} className="ros-viol-row" data-kind={l.severity} {...listItem}>
              {l.severity === "block" ? <Icon name="ban" size={24} /> : <Icon name="warning" size={24} />}
              <span>
                {/* The API's sentence usually starts with the person's name: bold it once instead of writing the name twice. */}
                {l.message.startsWith(l.person) ? <><b>{l.person}</b>{l.message.slice(l.person.length)}</> : <><b>{l.person}</b> {l.message}</>}
                {l.shifts.map((s) => (
                  <span key={s.id}>
                    {" · "}
                    <button type="button" className="ros-req-btn ros-conf-link num" onClick={() => onOpen(s.id)}>{s.label}</button>
                  </span>
                ))}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {needsOffice && <p className="ros-viol-more">Only the office can go over a blocked rule.</p>}
      {onOverride && !needsOffice && (
        <button type="button" className="btn btn-outline ros-more" onClick={onOverride}><Icon name="shield" size={24} />Go over it with a reason</button>
      )}
    </section>
  )
}
