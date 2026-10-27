"use client"

import { useEffect, useLayoutEffect, useRef } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"

import { DUR, EASE } from "@/lib/motion"

// Counts a numeric value up from 0 once, when it first scrolls into view (ui-rules.md rule 20).
// The server renders the final value, so no-JS and reduced-motion users see it as-is.
// Non-numeric values ("—", "4.2k") render unchanged.
export function CountUp({ value, delay = 0.1, duration = DUR.count }: { value: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const target = /^\d+$/.test(value) ? Number(value) : null
  const animated = target !== null && !reduce

  // Before paint: show 0 so an off-screen number is waiting at the start, not already finished.
  useLayoutEffect(() => {
    if (animated && ref.current) ref.current.textContent = "0"
  }, [animated])

  useEffect(() => {
    const el = ref.current
    if (!el || !animated || !inView) return
    const controls = animate(0, target, {
      duration,
      delay,
      ease: EASE,
      onUpdate: (v) => (el.textContent = String(Math.round(v))),
    })
    return () => controls.stop()
  }, [animated, inView, target, delay, duration])

  return <span ref={ref}>{value}</span>
}
