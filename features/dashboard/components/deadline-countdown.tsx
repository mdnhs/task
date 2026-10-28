"use client"

import * as React from "react"

import { RollNumber } from "@/components/roll-number"

const pad = (n: number) => String(n).padStart(2, "0")
// Last stretch before the deadline: the countdown's accent eases from brand to the warn token (CSS transition, no flashing).
const WARN_SECS = 15 * 60

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

// Hours / mins / secs left until the next occurrence of hour:minute in `timeZone`. Shared by the owner and staff dashboards.
export function DeadlineCountdown({ hour, minute, timeZone }: { hour: number; minute: number; timeZone: string }) {
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
    <div className="countdown" aria-live="polite" data-warn={left > 0 && left <= WARN_SECS ? "" : undefined}>
      {/* Each changed digit rolls down (the counter is decreasing) */}
      <div><b className="num"><RollNumber value={pad(Math.floor(left / 3600))} dir="down" /></b><span>Hours</span></div>
      <div><b className="num"><RollNumber value={pad(Math.floor((left % 3600) / 60))} dir="down" /></b><span>Mins</span></div>
      <div><b className="num"><RollNumber value={pad(left % 60)} dir="down" /></b><span>Secs</span></div>
    </div>
  )
}
