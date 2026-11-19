"use client"

import { AnimatePresence, motion } from "motion/react"
import { listItem } from "@/lib/motion"

import { Icon } from "@/components/icon"
import { formatDate } from "@/lib/dates"
import { repeatSummary } from "../repeating"
import { NamedLine } from "./named-line"
import type { RepeatConflict, RepeatCounts, WeekShift } from "../types"

// What a repeat or a template apply did (FR-RS-26/28, D10; Review Focus 5): nothing is dropped. The counts say how many shifts were kept, kept with a warning, or opened (a rule stopped the person:
// an open shift); the rows below are the API's conflicts. A row opens its shift when it is in view; assigning someone to an open shift is done from there.
export function ConflictsPanel({ conflicts, counts, shiftOf, nameOf, onOpen, onDismiss }: {
  conflicts: RepeatConflict[]
  counts: RepeatCounts
  shiftOf(id: string): WeekShift | undefined
  nameOf(id: string | null): string
  onOpen(shiftId: string): void
  onDismiss(): void
}) {
  if (!conflicts.length && counts.copied === 0) return null
  const sum = repeatSummary(counts, conflicts)
  return (
    <section className="card ros-panel" aria-label="Repeat conflicts">
      <div className="ros-panel-head">
        <h2>Repeat</h2>
        <span className="ros-sum num" aria-label={`${sum.kept} kept, ${sum.warned} with a warning, ${sum.opened} open`}>
          {sum.kept} kept · {sum.warned} warned · <b>{sum.opened} open</b>
        </span>
        <button type="button" className="ros-nav-btn ros-panel-x" aria-label="Dismiss conflicts" onClick={onDismiss}><Icon name="close" size={24} /></button>
      </div>
      {conflicts.length === 0 ? (
        <p className="ros-empty">Every shift kept its person.</p>
      ) : (
        <ul className="ros-viol">
          <AnimatePresence initial={false}>
            {conflicts.map((c) => {
              const s = shiftOf(c.shiftId)
              return (
                <motion.li key={`${c.shiftId}-${c.reason}`} className="ros-viol-row" data-kind={c.open ? "block" : "warn"} {...listItem}>
                  {c.open ? <Icon name="warning" size={24} /> : <Icon name="info" size={24} />}
                  <span>
                    <NamedLine person={nameOf(c.personId)} message={c.message} />
                    {" · "}
                    {s ? (
                      <button type="button" className="ros-req-btn ros-conf-link num" onClick={() => onOpen(c.shiftId)}>{formatDate(s.date)} {s.start}–{s.end}{c.open ? ", open shift" : ""}</button>
                    ) : (
                      <span className="num">{formatDate(c.date)}{c.open ? ", open shift" : ""}</span>
                    )}
                  </span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
