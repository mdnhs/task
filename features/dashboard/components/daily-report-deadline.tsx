"use client"

import { AnimatePresence, motion } from "motion/react"

import { useDept } from "@/hooks/use-dept"
import { layoutTransition, listItem } from "@/lib/motion"
import type { DailyReportData } from "../types"
import { DeadlineCountdown } from "./deadline-countdown"
import { RemindButton } from "./remind-button"

export function DailyReportDeadline({ data, canRemind }: { data: DailyReportData; canRemind: boolean }) {
  const { hour, minute, timeZone } = data.deadline
  // The topbar department filter hides the other departments' rows (enter/leave like every filtered list).
  const dep = useDept()
  const rows = data.reports.filter((r) => dep === "all" || r.dept === dep)

  return (
    <div className="card deadline">
      <h2>{data.title}</h2>
      <div className="big">{data.dueLabel}</div>
      <div className="tz">{data.timezoneNote}</div>
      <DeadlineCountdown hour={hour} minute={minute} timeZone={timeZone} />
      <AnimatePresence initial={false}>
      {rows.map((r) => (
        <motion.div key={r.dept} className="rep-row" layout="position" {...listItem} transition={layoutTransition}>
          <div>
            <span className="dep">{r.dept}</span>
            <small>{r.detail}</small>
            {r.progress !== undefined && <div suppressHydrationWarning className="progress"><i style={{ width: `${r.progress}%` }} /></div>}
          </div>
          <span className={`st ${r.status.tone}`}>{r.status.label}</span>
        </motion.div>
      ))}
      </AnimatePresence>
      {canRemind && <RemindButton label={data.action} />}
    </div>
  )
}
