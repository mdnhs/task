"use client"

import * as React from "react"

import { Icon } from "@/components/icons"
import { RollNumber } from "@/components/roll-number"
import type { DailyReportData } from "../types"

const pad = (n: number) => String(n).padStart(2, "0")

function zonedNow(timeZone: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())
  const g = (k: string) => +p.find((x) => x.type === k)!.value
  return g("hour") * 3600 + g("minute") * 60 + g("second")
}

export function DailyReportDeadline({ data }: { data: DailyReportData }) {
  const { hour, minute, timeZone } = data.deadline
  const [left, setLeft] = React.useState(0)

  React.useEffect(() => {
    const tick = () => {
      let l = hour * 3600 + minute * 60 - zonedNow(timeZone)
      if (l < 0) l += 86400
      setLeft(l)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [hour, minute, timeZone])

  return (
    <div className="card deadline">
      <h2>{data.title}</h2>
      <div className="big">{data.dueLabel}</div>
      <div className="tz">{data.timezoneNote}</div>
      <div className="countdown" aria-live="polite">
        {/* Each changed digit rolls down (the counter is decreasing) */}
        <div><b className="num"><RollNumber value={pad(Math.floor(left / 3600))} dir="down" /></b><span>Hours</span></div>
        <div><b className="num"><RollNumber value={pad(Math.floor((left % 3600) / 60))} dir="down" /></b><span>Mins</span></div>
        <div><b className="num"><RollNumber value={pad(left % 60)} dir="down" /></b><span>Secs</span></div>
      </div>
      {data.reports.map((r) => (
        <div key={r.dept} className="rep-row">
          <div>
            <span className="dep">{r.dept}</span>
            <small>{r.detail}</small>
            {r.progress !== undefined && <div className="progress"><i style={{ width: `${r.progress}%` }} /></div>}
          </div>
          <span className={`st ${r.status.tone}`}>{r.status.label}</span>
        </div>
      ))}
      <button className="btn btn-primary">
        <Icon name="chat" />
        {data.action}
      </button>
    </div>
  )
}
