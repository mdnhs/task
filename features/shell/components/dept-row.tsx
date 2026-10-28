"use client"

import * as React from "react"
import { motion } from "motion/react"

import type { Dept } from "@/lib/types"
import { layoutTransition } from "@/lib/motion"

import type { NavigationData } from "../types"

// Phones (≤640px): the topbar's DeptSeg is hidden and this full-width, scrollable pill row sits under the search.
// Same pressed-button semantics as DeptSeg; the sliding indicator has its own layoutId (both are in the DOM, one hidden).
export function DeptRow({
  items,
  dep,
  onChange,
}: {
  items: NavigationData["departments"]
  dep: Dept
  onChange: (dep: Dept) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)

  // Keep the active pill centred in the row. Scrolls only the row (never the page); instant on first paint.
  const first = React.useRef(true)
  React.useEffect(() => {
    const row = ref.current
    const btn = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !btn || row.clientWidth === 0) return
    const left = btn.offsetLeft - (row.clientWidth - btn.offsetWidth) / 2
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches
    row.scrollTo({ left, behavior: first.current || reduce ? "auto" : "smooth" })
    first.current = false
  }, [dep])

  return (
    <div ref={ref} className="dept-row" role="group" aria-label="Department">
      {items.map((f) => (
        <button key={f.dep} type="button" aria-pressed={dep === f.dep} onClick={() => onChange(f.dep)}>
          {dep === f.dep && <motion.span layoutId="dept-row-active" className="seg-ind" transition={layoutTransition} />}
          <span className="seg-lbl">{f.label}</span>
        </button>
      ))}
    </div>
  )
}
