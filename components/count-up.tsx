"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"

import { RollNumber } from "@/components/roll-number"
import { formatCount, parseCount } from "@/lib/count-format"
import { DUR, EASE, numDir } from "@/lib/motion"

// Counts a numeric value up from 0 once, when it first scrolls into view (ui-rules.md rule 20).
// The server renders the final value, so no-JS and reduced-motion users see it as-is.
// It counts plain numbers and numbers with affixes and grouping: "42", "94%", "€12,400", "£12.50", "4.2k" (lib/count-format.ts keeps the
// prefix, suffix, grouping and decimal places while it counts). A bare decimal ("1.6") counts only with `decimals`, because it may not be a quantity.
// Anything else ("—", "12.400,50 €", "3-5") renders unchanged.
// After that first count, a new value (e.g. the department filter changed) rolls per digit (<RollNumber>) instead of
// counting from 0 again: once the count settles, the number is handed to RollNumber, which then animates every change.
export function CountUp({ value, delay = 0.1, duration = DUR.count, decimals: allowDecimals = false }: { value: string; delay?: number; duration?: number; decimals?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" })
  const shape = parseCount(value)
  const usable = !!shape && (shape.decimals === 0 || allowDecimals || shape.prefix !== "" || shape.suffix !== "")
  const target = usable ? shape.target : null
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
    if (animated && !settled && shape && ref.current) ref.current.textContent = formatCount(0, shape)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the shape follows `value`, which settles with `first`
  }, [animated, settled])

  useEffect(() => {
    const el = ref.current
    if (!el || !animated || !inView || settled || !shape || target === null) return
    let live = true
    const controls = animate(0, target, {
      duration,
      delay,
      ease: EASE,
      onUpdate: (v) => (el.textContent = formatCount(v, shape)),
    })
    controls.then(() => live && setSettled(true))
    return () => {
      live = false
      controls.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shape` is derived from the value, `target` already tracks it
  }, [animated, inView, target, delay, duration, settled])

  // A value that changed before the count settled (or under reduced motion) just swaps in place.
  if (settled || value !== first) return <RollNumber value={value} dir={dir} />
  return <span ref={ref}>{value}</span>
}
