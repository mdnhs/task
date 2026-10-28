"use client"

import { AnimatePresence, motion } from "motion/react"

import { DUR, EASE_IN_OUT } from "@/lib/motion"

// A value that rolls when it changes, one digit slot at a time: only the digits that changed move.
// `dir="down"` (counters that decrease, like the countdown) brings the new digit in from above; "up" from below.
// Old and new digits share one grid cell (.roll), so nothing is taken out of flow and there's no layout jitter.
// Slots are keyed from the right (units, tens, …), so "48" → "9" rolls the units digit and drops the tens.
export function RollNumber({ value, dir = "up", duration = DUR.slow }: { value: string; dir?: "up" | "down"; duration?: number }) {
  const from = dir === "down" ? "-100%" : "100%"
  const to = dir === "down" ? "100%" : "-100%"
  return (
    <span className="roll-num">
      {/* Screen readers get the plain value once, not the overlapping old/new digits */}
      <span className="sr-only">{value}</span>
      {value.split("").map((ch, i, all) => (
        <span key={all.length - i} className="roll" aria-hidden="true">
          <AnimatePresence initial={false}>
            <motion.span
              key={ch}
              initial={{ y: from, opacity: 0, filter: "blur(2px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ y: to, opacity: 0, filter: "blur(2px)" }}
              transition={{ duration, ease: EASE_IN_OUT }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
