"use client"

import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { useDept } from "@/hooks/use-dept"
import { layoutTransition, listItem } from "@/lib/motion"
import type { ReportDeadlineCardData } from "../types"
import { DeadlineCountdown } from "./deadline-countdown"
import { RemindButton } from "./remind-button"

/**
 * Shift report deadline (FR-M1-22, FR-M1-28, FR-M1-30). Members see their own next report; managers one row per team in
 * their scope. The due time comes from the shift model (lib/report-deadline.ts), not a fixed daily deadline.
 */
export function ReportDeadlineCard({ data, canRemind }: { data: ReportDeadlineCardData; canRemind: boolean }) {
  // The topbar department filter hides the other teams' rows (enter/leave like every filtered list).
  const dep = useDept()
  const rows = data.kind === "team" ? data.rows.filter((r) => dep === "all" || r.key === dep) : data.rows
  const remind = data.kind === "team" && canRemind && data.missing > 0

  return (
    <div className="card deadline">
      <h2>{data.title}</h2>
      <div className="big">{data.dueLabel}</div>
      <div className="tz">{data.note}</div>
      <DeadlineCountdown seconds={data.seconds} />
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.div key={r.key} className="rep-row" layout="position" {...listItem} transition={layoutTransition}>
            <div>
              <Link href={r.href} className="dep">{r.label}</Link>
              <small>{r.detail}</small>
              {r.progress !== undefined && <div suppressHydrationWarning className="progress"><i style={{ width: `${r.progress}%` }} /></div>}
            </div>
            <StatusPill status={r.status} />
          </motion.div>
        ))}
      </AnimatePresence>
      {data.kind === "member" ? (
        <Link href={rows[0]?.href ?? "/daily-reports"} className="btn btn-primary">
          <Icon name="report" />
          Open my report
        </Link>
      ) : (
        remind && <RemindButton label={`Remind ${data.missing} missing`} />
      )}
    </div>
  )
}
