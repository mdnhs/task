"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"

import { DUR } from "@/lib/motion"

/**
 * Crossfades between two states of one spot (a "Seen" button that becomes a "Confirmed" pill, "Claim" → "Offered"). Keyed on `id`;
 * the old state leaves first, then the new one fades in at --dur-fast, so the spot never shows both. Never animates on mount.
 * Reduced motion is covered by the app-wide `<MotionConfig reducedMotion="user">`.
 */
export function FadeSwap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={id}
        className={className}
        style={{ display: "inline-flex", alignItems: "center", gap: "inherit" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: DUR.fast } }}
        exit={{ opacity: 0, transition: { duration: DUR.fast } }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}
