"use client"

import { AnimatePresence, motion } from "motion/react"

import { When } from "@/components/when"
import { listItem } from "@/lib/motion"
import type { TimelineEvent } from "../types"

// FR-M1-12 history: every change, oldest first, with old → new values and who was notified. New entries slide in at the bottom.
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
                {e.changes?.map((c, j) => (
                  <div key={j} className="td-tl-change">
                    <span className="td-tl-field">{c.field}</span> <s>{c.from}</s> → <strong>{c.to}</strong>
                  </div>
                ))}
                <div className="td-tl-meta"><When iso={e.at} today={today} tzLabel={tzLabel} /> · {e.by}{e.notified?.length ? ` · Notified ${e.notified.join(", ")}` : ""}</div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  )
}
