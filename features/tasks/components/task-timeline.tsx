"use client"

import { AnimatePresence, motion } from "motion/react"

import { When } from "@/components/when"
import { listItem } from "@/lib/motion"
import type { TimelineEvent } from "../types"

// FR-TASK-04: every change is listed here, oldest first, new entries slide in at the bottom.
export function TaskTimeline({ events, today, tzLabel }: { events: TimelineEvent[]; today: string; tzLabel: string }) {
  return (
    <section className="card" aria-labelledby="td-timeline-h">
      <h2 id="td-timeline-h" className="td-h">Timeline</h2>
      <ol className="td-timeline">
        <AnimatePresence initial={false}>
          {events.map((e, i) => (
            <motion.li key={`${e.at}-${i}`} {...listItem}>
              <span className="td-dot" aria-hidden="true" />
              <div>
                <div className="td-tl-text">{e.text}</div>
                <div className="td-tl-meta"><When iso={e.at} today={today} tzLabel={tzLabel} /> · {e.by}</div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  )
}
