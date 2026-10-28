"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"

import { RollNumber } from "@/components/roll-number"
import { DUR, EASE, numDir } from "@/lib/motion"

// Counts a numeric value up from 0 once, when it first scrolls into view (ui-rules.md rule 20).
// The server renders the final value, so no-JS and reduced-motion users see it as-is.
// Non-numeric values ("—", "4.2k") render unchanged.
// After that first count, a new value (e.g. the department filter changed) rolls per digit (<RollNumber>) instead of
// counting from 0 again: once the count settles, the number is handed to RollNumber, which then animates every change.
export function CountUp({ value, delay = 0.1, duration = DUR.count }: { value: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const target = /^\d+$/.test(value) ? Number(value) : null
  const animated = target !== null && !reduce
  // Settled = the count-up is over (or never ran). Only then does RollNumber take over.
  const [settled, setSettled] = useState(target === null)
  const [first] = useState(value)
  const [prev, setPrev] = useState(value)
  const [dir, setDir] = useState<"up" | "down">("up")
  if (prev !== value) {
    setDir(numDir(prev, value))
    setPrev(value)
  }

  // Before paint: show 0 so an off-screen number is waiting at the start, not already finished.
  useLayoutEffect(() => {
    if (animated && !settled && ref.current) ref.current.textContent = "0"
  }, [animated, settled])

  useEffect(() => {
    const el = ref.current
    if (!el || !animated || !inView || settled) return
    let live = true
    const controls = animate(0, target, {
      duration,
      delay,
      ease: EASE,
      onUpdate: (v) => (el.textContent = String(Math.round(v))),
    })
    controls.then(() => live && setSettled(true))
    return () => {
      live = false
      controls.stop()
    }
  }, [animated, inView, target, delay, duration, settled])

  // A value that changed before the count settled (or under reduced motion) just swaps in place.
  if (settled || value !== first) return <RollNumber value={value} dir={dir} />
  return <span ref={ref}>{value}</span>
}
