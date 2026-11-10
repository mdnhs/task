"use client"

import { useLayoutEffect, useRef } from "react"
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react"

import { EASE, STRETCH } from "@/lib/motion"

type Box = { start: number; end: number; top: number; bottom: number; left: number; right: number }

/**
 * One indicator that moves between the items of its container and stretches while it does: the edge facing the direction of travel
 * leaves first, the other edge catches up a moment later (STRETCH in lib/motion.ts). It replaces the per-item `layoutId` indicators.
 *
 * - Put it as the FIRST child of a positioned container (the items come later in the DOM, so they paint above it).
 * - `active` is any value that changes when the active item changes; `selector` finds the active item inside the container.
 * - axis "x" stretches left/right (tabs), "y" top/bottom (a vertical list), "auto" picks from the container's flex direction. `fit` sets the cross axis from the item too;
 *   with `fit={false}` the cross axis is left to CSS (the sidebar's thin bar). `inset` trims the item box along the axis.
 * - Until it has measured (server render, first paint) the container has no `data-st`, and CSS paints the active item itself,
 *   so there is no flash. With reduced motion or on the first measure it snaps. Resizes snap too.
 * Only left/right/top/bottom of a small pill move, never a large surface (ui-rules.md rule 15).
 */
export function StretchIndicator({
  active,
  className,
  selector = '[aria-pressed="true"],[aria-current="page"]',
  axis = "x",
  fit = true,
  inset = [0, 0],
}: {
  active: string | number | null
  className: string
  selector?: string
  /** "auto" follows the container: a column flex box moves along y, anything else along x (settings tabs turn into a row on phones). Needs `fit`. */
  axis?: "x" | "y" | "auto"
  fit?: boolean
  inset?: [number, number]
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const left = useMotionValue(0)
  const right = useMotionValue(0)
  const top = useMotionValue(0)
  const bottom = useMotionValue(0)
  const ready = useRef(false)
  const lastAx = useRef<"x" | "y" | null>(null)

  useLayoutEffect(() => {
    const me = ref.current
    const box = me?.parentElement
    if (!me || !box) return
    const axisOf = (): "x" | "y" => (axis === "auto" ? (getComputedStyle(box).flexDirection.startsWith("column") ? "y" : "x") : axis)
    const measure = (): (Box & { ax: "x" | "y" }) | null => {
      const ax = axisOf()
      const el = box.querySelector<HTMLElement>(selector)
      if (!el || !box.contains(el)) return null
      const b = box.getBoundingClientRect()
      const a = el.getBoundingClientRect()
      const l = a.left - b.left - box.clientLeft + box.scrollLeft
      const t = a.top - b.top - box.clientTop + box.scrollTop
      const w = box.clientWidth
      const h = box.clientHeight
      const [i0, i1] = inset
      return ax === "x"
        ? { ax, start: l + i0, end: l + a.width - i1, left: l + i0, right: w - (l + a.width) + i1, top: t, bottom: h - (t + a.height) }
        : { ax, start: t + i0, end: t + a.height - i1, top: t + i0, bottom: h - (t + a.height) + i1, left: l, right: w - (l + a.width) }
    }
    const snap = (m: Box & { ax: "x" | "y" }) => {
      if (m.ax === "x") {
        left.set(m.left)
        right.set(m.right)
        if (fit) { top.set(m.top); bottom.set(m.bottom) }
      } else {
        top.set(m.top)
        bottom.set(m.bottom)
        if (fit) { left.set(m.left); right.set(m.right) }
      }
    }
    const m = measure()
    if (!m) {
      me.style.visibility = "hidden"
      return
    }
    me.style.visibility = ""
    if (!ready.current || reduce) {
      snap(m)
      lastAx.current = m.ax
      ready.current = true
      box.dataset.st = "1"
    } else {
      // Which edge leads: the one on the side the indicator is travelling towards.
      const near = m.ax === "x" ? left : top
      const far = m.ax === "x" ? right : bottom
      // A change of orientation (a tab list turning into a row) snaps instead of stretching.
      if (lastAx.current !== m.ax) {
        snap(m)
        lastAx.current = m.ax
        return
      }
      const forward = (m.ax === "x" ? m.left : m.top) > near.get()
      const to = m.ax === "x" ? { near: m.left, far: m.right } : { near: m.top, far: m.bottom }
      // Moving forward the far edge (right/bottom) leads; moving back the near edge (left/top) leads.
      animate(forward ? far : near, forward ? to.far : to.near, { duration: STRETCH.lead, ease: EASE })
      animate(forward ? near : far, forward ? to.near : to.far, { duration: STRETCH.trail, ease: EASE, delay: STRETCH.lag })
      if (fit) {
        const [c0, c1] = m.ax === "x" ? [top, bottom] : [left, right]
        const [t0, t1] = m.ax === "x" ? [m.top, m.bottom] : [m.left, m.right]
        c0.set(t0)
        c1.set(t1)
      }
    }
    // A resize or a late font changes the item's box: snap to it, no animation.
    const ro = new ResizeObserver(() => {
      const again = measure()
      if (again) {
        snap(again)
        lastAx.current = again.ax
      }
    })
    ro.observe(box)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure only when the active item changes
  }, [active, reduce])

  const style = fit || axis === "auto" ? { left, right, top, bottom } : axis === "x" ? { left, right } : { top, bottom }
  return <motion.span ref={ref} className={className} style={{ ...style, position: "absolute" }} aria-hidden="true" />
}
