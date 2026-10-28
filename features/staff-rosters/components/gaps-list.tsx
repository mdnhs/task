"use client"

import { AnimatePresence, motion } from "motion/react"

import { useSlideDir } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { layoutTransition, listItem } from "@/lib/motion"
import { COVERAGE, WHEN_LABEL, WHEN_ORDER } from "../types"
import type { RosterGap } from "../types"

// Rows of the current page, grouped Today / Tomorrow / Next week. Groups with no row on this page are not rendered.
export function GapsList({ rows, page, tzLabel, onOpen }: { rows: RosterGap[]; page: number; tzLabel: string; onOpen(id: string): void }) {
  const dir = useSlideDir(page)
  return (
    // Keyed by page: a page change slides the groups in from the paging side.
    <div key={page} className="sr-groups od-slide" data-slide={dir}>
      {WHEN_ORDER.map((w) => {
        const group = rows.filter((g) => g.when === w)
        if (!group.length) return null
        return (
          <section key={w} className="sr-group" aria-labelledby={`sr-g-${w}`}>
            <h3 id={`sr-g-${w}`} className="sr-group-h">{WHEN_LABEL[w]}</h3>
            <ul className="sr-list">
              <AnimatePresence initial={false}>
                {group.map((g) => (
                  <motion.li key={g.id} layout="position" {...listItem} transition={layoutTransition}>
                    <button type="button" className="sr-row" onClick={() => onOpen(g.id)}>
                      <span className="sr-main">
                        <span className="sr-title">{g.site} · {g.role}</span>
                        <span className="sr-sum">
                          <When iso={g.shiftStart} today="" tzLabel="" mode="date" /> {g.time} {tzLabel} · {g.client}
                        </span>
                        <span className="sr-sum"><b>Next:</b> {g.nextAction}</span>
                      </span>
                      <span className="sr-meta">
                        <StatusPill status={COVERAGE[g.coverage]} />
                        <span className="sr-assigned">{g.assigned || <span className="sr-none">Nobody assigned</span>}</span>
                        <span className="sr-owner">Owner {g.owner}</span>
                      </span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        )
      })}
    </div>
  )
}
