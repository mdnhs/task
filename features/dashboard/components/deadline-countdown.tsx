"use client"

import * as React from "react"

import { RollNumber } from "@/components/roll-number"

const pad = (n: number) => String(n).padStart(2, "0")
// Last stretch before the deadline: the countdown's accent eases from brand to the warn token (CSS transition, no flashing).
const WARN_SECS = 15 * 60

/**
 * Hours / mins / secs left. `seconds` is computed on the server against the tenant's now (lib/report-deadline secondsUntil),
 * so the first paint matches the server render; from then on it ticks down with the real clock.
 */
export function DeadlineCountdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = React.useState(seconds)

  React.useEffect(() => {
    const start = Date.now()
    const tick = () => setLeft(Math.max(0, seconds - Math.floor((Date.now() - start) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [seconds])

  return (
    <div className="countdown" aria-live="polite" data-warn={left > 0 && left <= WARN_SECS ? "" : undefined}>
      {/* Each changed digit rolls down (the counter is decreasing) */}
      <div><b className="num"><RollNumber value={pad(Math.floor(left / 3600))} dir="down" /></b><span>Hours</span></div>
      <div><b className="num"><RollNumber value={pad(Math.floor((left % 3600) / 60))} dir="down" /></b><span>Mins</span></div>
      <div><b className="num"><RollNumber value={pad(left % 60)} dir="down" /></b><span>Secs</span></div>
    </div>
  )
}
