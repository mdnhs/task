"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { toCard } from "../adapters"
import { addDays } from "../recurrence"
import { byDueDay, monthGrid, monthLabel, shiftMonth, weekLabel, weekOf } from "../calendar"
import { STATUS } from "../types"
import type { Person, Project, Task } from "../types"
import { BoardFilters, NO_BOARD_FILTERS, type BoardFilterValues } from "./task-board"
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

/** The 42 days a month view shows (six Monday-first weeks): the most the API's calendar answers in one call. */
export const rangeOf = (anchor: string, mode: "month" | "week") => {
  const days = mode === "month" ? monthGrid(anchor).flat() : weekOf(anchor)
  return { from: days[0]!, to: days[days.length - 1]! }
}

/**
 * Calendar view by due date (FR-M1-05): month or week, Monday first. The days are the TENANT's (the API cuts them in the tenant zone, DST days included); each window is one
 * call, and moving to another month or week asks again. The API has no filter on the calendar, so the search, project and assignee narrow the cards of the loaded window.
 */
export function TaskCalendar({ tasks: first, truncated: firstTruncated, range, people, projects, today, staff }: {
  tasks: Task[]
  truncated: boolean
  /** The window `tasks` covers (the server's first answer). */
  range: { from: string; to: string }
  people: Person[]
  projects: Project[]
  today: string
  tzLabel: string
  staff: boolean
}) {
  const dept = useDept()
  const [f, setF] = useState<BoardFilterValues>(NO_BOARD_FILTERS)
  const [mode, setMode] = useState<"month" | "week">("month")
  const day0 = today.slice(0, 10)
  const [anchor, setAnchor] = useState(day0)
  const [loaded, setLoaded] = useState<{ from: string; to: string; tasks: Task[]; truncated: boolean }>({ ...range, tasks: first, truncated: firstTruncated })
  const [loading, setLoading] = useState(false)
  const want = rangeOf(anchor, mode)
  const seq = useRef(0)
  const covers = loaded.from <= want.from && want.to <= loaded.to
  useEffect(() => {
    if (covers) return
    const mine = ++seq.current
    void (async () => {
      setLoading(true)
      try {
        const win = rangeOf(anchor, "month")
        const w = mode === "month" ? win : want
        const c = await apiBrowser.get("/v1/tasks/calendar", { query: { from: w.from, to: w.to } })
        if (mine === seq.current) setLoaded({ ...w, tasks: c.days.flatMap((d) => d.tasks.map(toCard)), truncated: c.truncated })
      } catch (e) {
        toast.error(userMessage(e).text)
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, mode, covers])

  const byId = useMemo(() => new Map(people.map((x) => [x.id, x])), [people])
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return loaded.tasks.filter(
      (t) =>
        (dept === "all" || t.dept === dept) &&
        (f.project === "all" || t.projectId === f.project) &&
        (f.assignee === "all" || t.assignee === f.assignee || t.assignees?.includes(f.assignee)) &&
        (!q || [t.title, t.ref, byId.get(t.assignee)?.name ?? "", ...t.tags].some((s) => s.toLowerCase().includes(q))),
    )
  }, [loaded.tasks, dept, f, byId])
  const days = byDueDay(rows)
  const month = anchor.slice(0, 7)
  const step = (n: number) => setAnchor((a) => (mode === "month" ? shiftMonth(a, n) : addDays(a, 7 * n)))

  return (
    <>
      <PageHead title="Tasks" subtitle={`${rows.length} tasks by due date`} />
      <TaskViewTabs active="calendar" />
      <div className="card tasks-card" aria-busy={loading || undefined}>
        <BoardFilters {...f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} people={people} projects={projects} staff={staff}>
          <FilterSeg label="Calendar range" value={mode} options={MODES} onChange={(v) => setMode(v as "month" | "week")} />
        </BoardFilters>
        <div className="cal-nav">
          <button type="button" className="btn btn-outline cal-btn" aria-label={mode === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}>←</button>
          <button type="button" className="btn btn-outline cal-btn" onClick={() => setAnchor(day0)}>Today</button>
          <button type="button" className="btn btn-outline cal-btn" aria-label={mode === "month" ? "Next month" : "Next week"} onClick={() => step(1)}>→</button>
          <h2 className="cal-title" aria-live="polite">{mode === "month" ? monthLabel(anchor) : weekLabel(anchor)}</h2>
        </div>
        {loaded.truncated && <p className="td-muted">Showing the first 1,000 tasks of this period.</p>}
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
                      {list.slice(0, MONTH_CHIPS).map((t) => <Chip key={t.id} t={t} />)}
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
                  {list.length ? list.map((t) => <Chip key={t.id} t={t} />) : <span className="cal-none">Nothing due</span>}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
