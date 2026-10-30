"use client"

import { AnimatePresence, motion } from "motion/react"
import Link from "next/link"

import { useSlideDir } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { layoutTransition, listItem } from "@/lib/motion"
import { gapHref } from "../logic"
import { COVERAGE, WHEN_LABEL, WHEN_ORDER } from "../types"
import type { RosterGap } from "../types"

// Rows of the current page (each links to /staff-rosters/gaps/[id]), grouped Today / Tomorrow / Next week. Groups with no row on this page are not rendered.
export function GapsList({ rows, page, tzLabel }: { rows: RosterGap[]; page: number; tzLabel: string }) {
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
                    <Link href={gapHref(g.id)} className="sr-row">
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
                    </Link>
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
