"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

import { ACTION, DUR, EASE, layoutTransition } from "@/lib/motion"
import type { Status } from "@/lib/types"

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE } },
}

// Maps onto the existing .st pill and its tone classes (ok/warn/bad/info/mute). Always shows the text label.
// When the status changes after mount: the tone colours crossfade (CSS transition on .st), the new label fades in, the
// pill's width eases to fit (motion `layout="size"`, children counter-scaled so the text never stretches) and, unless
// `tick={false}` (a change the user didn't make), a ✓ draws in front of the label for a moment. Nothing animates on mount.
export function StatusPill({ status, tick = true }: { status: Status; tick?: boolean }) {
  const key = `${status.tone}|${status.label}`
  const [seen, setSeen] = useState(key)
  const [change, setChange] = useState(0)
  const [ack, setAck] = useState(false)
  if (seen !== key) {
    setSeen(key)
    setChange((n) => n + 1)
    setAck(tick)
  }
  // The ✓ is brief: it leaves (and the pill eases back to the label's width) after ACTION.done.
  useEffect(() => {
    if (!ack) return
    const t = setTimeout(() => setAck(false), ACTION.done * 1000)
    return () => clearTimeout(t)
  }, [ack, change])

  return (
    <motion.span layout="size" transition={layoutTransition} className={`st ${status.tone}`} style={{ borderRadius: 8 }}>
      <AnimatePresence initial={false}>
        {ack && (
          <motion.svg key={`tick-${change}`} layout="position" className="st-tick" viewBox="0 0 12 12" aria-hidden="true" {...fade}>
            <path d="M2.5 6.2 5 8.6l4.5-5" />
          </motion.svg>
        )}
      </AnimatePresence>
      <motion.span key={status.label} layout="position" transition={layoutTransition} initial={change ? { opacity: 0 } : false} animate={{ opacity: 1 }}>
        {status.label}
      </motion.span>
    </motion.span>
  )
}
