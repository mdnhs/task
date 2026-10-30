"use client"

import { useState } from "react"
import Link from "next/link"

import { FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { addDays } from "../recurrence"
import { byDueDay, monthGrid, monthLabel, shiftMonth, weekLabel, weekOf } from "../calendar"
import { STATUS } from "../types"
import type { Task } from "../types"
import { BoardFilters, useBoardRows, type BoardProps } from "./task-board"
import { TaskViewTabs } from "./task-view-tabs"

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MODES = [
  { value: "month" as const, label: "Month" },
  { value: "week" as const, label: "Week" },
]
/** Chips shown per month cell before "+n more". */
export const MONTH_CHIPS = 3

function Chip({ t }: { t: Task }) {
  return (
    <Link href={`/tasks/${t.ref}`} className={`cal-chip ${STATUS[t.status].tone}`} title={`${t.ref} · ${t.title} · ${STATUS[t.status].label}`}>
      <span className="cal-time num">{t.due.slice(11, 16)}</span> {t.title}
    </Link>
  )
}

/** Calendar view by due date (FR-M1-05): month or week, Monday first, in the tenant's wall clock. */
export function TaskCalendar(props: BoardProps) {
  const { people, projects, today, onlyAssignee } = props
  const [f, setF] = useState({ q: "", project: "all", assignee: "all" })
  const { rows } = useBoardRows(props, f)
  const [mode, setMode] = useState<"month" | "week">("month")
  const day0 = today.slice(0, 10)
  const [anchor, setAnchor] = useState(day0)
  const days = byDueDay(rows)
  const month = anchor.slice(0, 7)
  const step = (n: number) => setAnchor((a) => (mode === "month" ? shiftMonth(a, n) : addDays(a, 7 * n)))

  return (
    <>
      <PageHead title="Tasks" subtitle={`${rows.length} tasks by due date`} />
      <TaskViewTabs active="calendar" />
      <div className="card tasks-card">
        <BoardFilters {...f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} people={people} projects={projects} onlyAssignee={onlyAssignee}>
          <FilterSeg label="Calendar range" value={mode} options={MODES} onChange={(v) => setMode(v as "month" | "week")} />
        </BoardFilters>
        <div className="cal-nav">
          <button type="button" className="btn btn-outline cal-btn" aria-label={mode === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}>←</button>
          <button type="button" className="btn btn-outline cal-btn" onClick={() => setAnchor(day0)}>Today</button>
          <button type="button" className="btn btn-outline cal-btn" aria-label={mode === "month" ? "Next month" : "Next week"} onClick={() => step(1)}>→</button>
          <h2 className="cal-title" aria-live="polite">{mode === "month" ? monthLabel(anchor) : weekLabel(anchor)}</h2>
        </div>
        {mode === "month" ? (
          <div className="cal-month" role="grid" aria-label={monthLabel(anchor)}>
            <div className="cal-row cal-dow" role="row">{DOW.map((d) => <div key={d} role="columnheader">{d}</div>)}</div>
            {monthGrid(anchor).map((week) => (
              <div key={week[0]} className="cal-row" role="row">
                {week.map((d) => {
                  const list = days.get(d) ?? []
                  return (
                    <div key={d} role="gridcell" className="cal-cell" data-out={d.slice(0, 7) !== month ? "" : undefined} data-today={d === day0 ? "" : undefined}>
                      <span className="cal-day num">{Number(d.slice(8, 10))}</span>
                      {list.slice(0, MONTH_CHIPS).map((t) => <Chip key={t.ref} t={t} />)}
                      {list.length > MONTH_CHIPS && (
                        <button type="button" className="cal-more" onClick={() => { setAnchor(d); setMode("week") }}>+{list.length - MONTH_CHIPS} more</button>
                      )}
                      {list.length > 0 && <span className="cal-dots" aria-hidden="true">{list.length}</span>}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="cal-week">
            {weekOf(anchor).map((d, i) => {
              const list = days.get(d) ?? []
              return (
                <section key={d} className="cal-wday" data-today={d === day0 ? "" : undefined} aria-label={`${DOW[i]} ${d}`}>
                  <header className="cal-whead"><span>{DOW[i]}</span> <span className="num">{Number(d.slice(8, 10))}</span></header>
                  {list.length ? list.map((t) => <Chip key={t.ref} t={t} />) : <span className="cal-none">Nothing due</span>}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
