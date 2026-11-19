"use client"

import { useMemo, useState, type ReactNode } from "react"

import { useSlideDir } from "@/components/data-pagination"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate, formatTime } from "@/lib/dates"
import { leaveOn, monthGrid, monthLabel, shiftMonth, shiftsByDay } from "../calendar"
import { leaveKindLabel } from "../self-service"
import type { ApiLeave, MineShift } from "../types"
import { Icon } from "@/components/icon"

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
/** Shift chips shown in a month cell before "+n more" (the day's full list is under the grid). */
const CHIPS = 2

/** A shift as the calendar needs it: wall times and the place's name, both the API's. */
export type CalShift = Pick<MineShift, "id" | "date" | "start" | "end" | "locationName">

const full = (s: CalShift) => `${formatTime(`${s.date}T${s.start}`)}–${formatTime(`${s.date}T${s.end}`)}`
/** "10 PM–6 AM": the on-the-hour minutes are dropped so a chip fits a narrow cell. */
const short = (s: CalShift) => `${formatTime(`${s.date}T${s.start}`)}–${formatTime(`${s.date}T${s.end}`)}`.replaceAll(":00", "")

/** Month calendar of the signed-in person's published shifts and leave (FR-RS-40). Pick a day to see its shifts under the grid. */
export function MyCalendar({
  shifts,
  leave,
  today,
  renderShift,
}: {
  shifts: CalShift[]
  leave: ApiLeave[]
  today: string
  /** The same shift row the Shifts tab uses (times, Confirm, Swap). */
  renderShift: (id: string, close: () => void) => ReactNode
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
          <Icon name="chevron-left" size={24} />
        </button>
        <button type="button" className="mc-btn mc-today" onClick={() => { setAnchor(day0); setPicked(day0) }}>
          Today
        </button>
        <button type="button" className="mc-btn" aria-label="Next month" onClick={() => go(1)}>
          <Icon name="chevron-right" size={24} />
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
                    <button key={s.id} type="button" className="mc-chip" title={`${full(s)} · ${s.locationName}`}>
                      <b className="num">{short(s)}{s.end <= s.start && <i> +1</i>}</b>
                      <small>{s.locationName}</small>
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
              {away ? ` ${leaveKindLabel(away.kind)} leave: ${away.status === "approved" ? "approved" : "waiting"}.` : ""}
            </DialogDescription>
          </DialogHeader>
          {list.length > 0 && <ul className="mr-list">{list.map((s) => renderShift(s.id, () => setOpen(false)))}</ul>}
          {away && <p className="mc-detail-leave">{leaveKindLabel(away.kind)} · {formatDate(away.from)} to {formatDate(away.to)}</p>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
