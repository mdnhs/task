"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { useSlideDir } from "@/components/data-pagination"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatTime } from "@/lib/dates"
import type { LeaveRequest } from "@/lib/roster-rules"
import type { RosterShift } from "@/lib/rosters"
import { leaveOn, monthGrid, monthLabel, shiftMonth, shiftsByDay } from "../calendar"

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
/** Shift chips shown in a month cell before "+n more" (the day's full list is under the grid). */
const CHIPS = 2

const full = (s: RosterShift) => `${formatTime(`${s.date}T${s.start}`)}–${formatTime(`${s.date}T${s.end}`)}`
/** "10 PM–6 AM": the on-the-hour minutes are dropped so a chip fits a narrow cell. */
const short = (s: RosterShift) => `${formatTime(`${s.date}T${s.start}`)}–${formatTime(`${s.date}T${s.end}`)}`.replaceAll(":00", "")

/** Month calendar of the signed-in person's published shifts and leave (FR-RS-40). Pick a day to see its shifts under the grid. */
export function MyCalendar({
  shifts,
  leave,
  today,
  places,
  renderShift,
}: {
  shifts: RosterShift[]
  leave: LeaveRequest[]
  today: string
  places: Map<string, string>
  /** The same shift row the Shifts tab uses (times, Seen, Swap, add to calendar). */
  renderShift: (s: RosterShift, close: () => void) => ReactNode
}) {
  const day0 = today.slice(0, 10)
  const days = useMemo(() => shiftsByDay(shifts), [shifts])
  // Open on today, or on the next day with a shift if today is free, so the detail is not empty on arrival.
  const first = useMemo(() => [...days.keys()].sort().find((d) => d >= day0) ?? day0, [days, day0])
  const [anchor, setAnchor] = useState(first)
  const [picked, setPicked] = useState(first)
  const [open, setOpen] = useState(false)
  // A day opens its details when it holds a shift or leave; an empty day only moves the highlight.
  const pick = (d: string) => {
    setPicked(d)
    setOpen((days.get(d)?.length ?? 0) > 0 || !!leaveOn(d, leave))
  }
  const month = anchor.slice(0, 7)
  const monthDir = useSlideDir(Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)))
  const go = (n: number) => setAnchor((a) => shiftMonth(a, n))
  const inMonth = useMemo(() => shifts.filter((s) => s.date.startsWith(month)).length, [shifts, month])
  const list = days.get(picked) ?? []
  const away = leaveOn(picked, leave)

  return (
    <section className="mc" aria-label="My calendar">
      <div className="mc-nav">
        <button type="button" className="mc-btn" aria-label="Previous month" onClick={() => go(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="mc-btn mc-today" onClick={() => { setAnchor(day0); setPicked(day0) }}>
          Today
        </button>
        <button type="button" className="mc-btn" aria-label="Next month" onClick={() => go(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
        <h2 className="mc-title" aria-live="polite">{monthLabel(anchor)}</h2>
        <span className="mc-count">{inMonth === 0 ? "No shifts this month" : `${inMonth} shift${inMonth > 1 ? "s" : ""} this month`}</span>
      </div>
      <div className="mc-grid od-slide" key={month} data-slide={monthDir} role="grid" aria-label={monthLabel(anchor)}>
        <div className="mc-row mc-dow" role="row">
          {DOW.map((d) => <div key={d} role="columnheader">{d}</div>)}
        </div>
        {monthGrid(anchor).map((week) => (
          <div key={week[0]} className="mc-row" role="row">
            {week.map((d) => {
              const mine = days.get(d) ?? []
              const l = leaveOn(d, leave)
              return (
                <div
                  key={d}
                  role="gridcell"
                  className="mc-cell"
                  data-out={d.slice(0, 7) !== month ? "" : undefined}
                  data-today={d === day0 ? "" : undefined}
                  data-picked={d === picked ? "" : undefined}
                  data-leave={l ? l.status : undefined}
                  aria-selected={d === picked}
                  onClick={() => pick(d)}
                >
                  <button type="button" className="mc-day num" aria-label={`${formatDate(d)}${mine.length ? `, ${mine.length} shift${mine.length > 1 ? "s" : ""}` : ""}${l ? ", leave" : ""}`}>
                    {Number(d.slice(8, 10))}
                  </button>
                  {mine.slice(0, CHIPS).map((s) => (
                    <button key={s.id} type="button" className="mc-chip" title={`${full(s)} · ${places.get(s.locationId) ?? ""}`}>
                      <b className="num">{short(s)}{s.end <= s.start && <i> +1</i>}</b>
                      <small>{places.get(s.locationId) ?? ""}</small>
                    </button>
                  ))}
                  {mine.length > CHIPS && (
                    <button type="button" className="mc-more">
                      +{mine.length - CHIPS} more
                    </button>
                  )}
                  {l && <span className="mc-leave">{l.status === "approved" ? "Leave" : "Leave asked"}</span>}
                  {(mine.length > 0 || l) && <span className="mc-dots" aria-hidden="true" data-leave={mine.length === 0 ? "" : undefined}>{mine.length || "L"}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <ul className="mc-legend" aria-label="Legend">
        <li><i data-k="shift" />Shift</li>
        <li><i data-k="leave" />Leave</li>
        <li><i data-k="today" />Today</li>
      </ul>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="od-dialog mc-dlg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{formatDate(picked)}</DialogTitle>
            <DialogDescription>
              {list.length === 0 ? "No shifts." : `${list.length} shift${list.length > 1 ? "s" : ""}.`}
              {away ? ` ${away.kind}: ${away.status === "approved" ? "approved" : "waiting for a decision"}.` : ""}
            </DialogDescription>
          </DialogHeader>
          {list.length > 0 && <ul className="mr-list">{list.map((s) => renderShift(s, () => setOpen(false)))}</ul>}
          {away && <p className="mc-detail-leave">{away.kind} · {formatDate(away.from)} to {formatDate(away.to)}</p>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
