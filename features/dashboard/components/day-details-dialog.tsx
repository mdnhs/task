"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { TasksClosedDay } from "../types"
import { Icon } from "@/components/icon"

type Day = TasksClosedDay

const kindLabel: Record<Day["t"], string> = { s1: "Weekday", s2: "Weekday", weekend: "Weekend cover", today: "Today" }

export function DayDetailsDialog({ day: current, onClose }: { day: Day | null; onClose: () => void }) {
  // Keep showing the last day while the close animation runs; otherwise the popup empties and collapses mid-fade.
  const [day, setDay] = useState(current)
  if (current && current !== day) setDay(current)
  return (
    <Dialog open={!!current} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="od-dialog">
        {day && (
          <>
            <div className="od-dialog-head">
              <div>
                <span className={`dd-kind ${day.t}`}>{kindLabel[day.t]}</span>
                <DialogTitle className="od-dialog-title">{day.date}</DialogTitle>
                <DialogDescription className="od-dialog-sub">
                  {day.n} tasks closed · {day.on}% on time
                </DialogDescription>
              </div>
              <DialogClose render={<Button variant="ghost" size="icon" className="ai-close" aria-label="Close" />}>
                <Icon name="close" size={24} />
              </DialogClose>
            </div>

            <div className="dd-stats">
              <div><b className="num">{day.n}</b><span>Closed</span></div>
              <div><b className="num">{day.on}%</b><span>On time</span></div>
              <div><b className={`num ${day.late ? "late" : ""}`}>{day.late}</b><span>Late</span></div>
            </div>

            {day.topCloser && (
              <div className="dd-sec">
                <div className="dd-top">
                  Top closer: <b>{day.topCloser.name}</b> · <span className="num">{day.topCloser.count}</span> {day.topCloser.count === 1 ? "task" : "tasks"}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
