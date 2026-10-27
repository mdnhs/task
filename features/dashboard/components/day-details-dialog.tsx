"use client"

import { useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { TasksClosedData } from "../types"

type Day = TasksClosedData["days"][number]

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
                <X />
              </DialogClose>
            </div>

            <div className="dd-stats">
              <div><b className="num">{day.n}</b><span>Closed</span></div>
              <div><b className="num">{day.on}%</b><span>On time</span></div>
              <div><b className={`num ${day.late ? "late" : ""}`}>{day.late}</b><span>Late</span></div>
              <div><b className="num">{day.avgHours}h</b><span>Avg to close</span></div>
            </div>

            <div className="dd-sec">
              <div className="sec-title">By department</div>
              <div className="dd-split" role="img" aria-label={`Security ${day.byDept.security}, Cleaning ${day.byDept.cleaning}`}>
                <i className="sec" style={{ flex: day.byDept.security }} />
                <i className="cln" style={{ flex: day.byDept.cleaning }} />
              </div>
              <div className="dd-split-legend">
                <span><i className="sw solid" />Security <b className="num">{day.byDept.security}</b></span>
                <span><i className="sw light" />Cleaning <b className="num">{day.byDept.cleaning}</b></span>
              </div>
            </div>

            <div className="dd-sec">
              <div className="sec-title">Closed tasks</div>
              <div className="dd-tasks">
                {day.tasks.map((t) => (
                  <div key={t.ref} className="dd-task">
                    <div>
                      <div className="tt">{t.title}</div>
                      <div className="tm"><span className="num">{t.ref}</span> · {t.by}</div>
                    </div>
                    <span className="dep-tag">{t.dept}</span>
                  </div>
                ))}
              </div>
              <div className="dd-top">
                Top closer: <b>{day.topCloser.name}</b> · <span className="num">{day.topCloser.count}</span> tasks
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
