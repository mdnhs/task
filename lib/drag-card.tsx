"use client"

// Shared drag-and-drop look and motion for cards that move between containers (recruitment kanban, roster day columns).
// One place for the sensors, the lifted-card tilt, the drop animation and the zoom correction, so every board feels the same.
// Styles live in app/styles/drag.css (.dnd-card, .dnd-lifted, .dnd-grip).
import { useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  defaultDropAnimationSideEffects,
  useDndMonitor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DropAnimation, KeyboardCoordinateGetter, Modifier } from "@dnd-kit/core"
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react"

import { cssZoom, unzoomOverlay } from "@/lib/zoom"

export const DRAG_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
/** Cards that make room for a held card slide with this transition (null under reduced motion). */
export const DRAG_SLIDE = { duration: 220, easing: DRAG_EASE }
/** Horizontal speed (px/s) that gives the full tilt, and that tilt in degrees. */
export const TILT_SPEED = 1800
export const TILT_MAX = 10
const TILT_SPRING = { stiffness: 300, damping: 20, mass: 0.6 }

/** The Text size preset zooms <body>; keep the lifted card under the pointer (lib/zoom.ts). */
export const zoomOverlay: Modifier = ({ transform, activeNodeRect }) => (activeNodeRect ? unzoomOverlay(transform, activeNodeRect, cssZoom(document.body)) : transform)

/** The overlay settles into the card's new slot; the slot fades back in underneath it. */
export const DROP: DropAnimation = {
  duration: 220,
  easing: DRAG_EASE,
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
}

/** Tilt in degrees for a horizontal drag speed: linear, clamped to ±TILT_MAX. */
export function tiltFor(speed: number): number {
  return Math.max(-TILT_MAX, Math.min(TILT_MAX, (speed / TILT_SPEED) * TILT_MAX))
}

/** CSS transform-origin for the grab point inside the card rect (centre when there is no pointer, e.g. a keyboard lift). */
export function pivotOrigin(rect: { left: number; top: number; width: number; height: number } | undefined, point: { clientX: number; clientY: number } | undefined): string {
  return rect && point && rect.width > 0 && rect.height > 0 ? `${((point.clientX - rect.left) / rect.width) * 100}% ${((point.clientY - rect.top) / rect.height) * 100}%` : "50% 50%"
}

/** Pivot for the tilt from the event that started the drag; `selector` finds the card around the grabbed element. */
export function originOf(ev: Event, selector: string): string {
  const r = (ev.target as Element | null)?.closest(selector)?.getBoundingClientRect()
  const p = ev instanceof MouseEvent ? ev : typeof TouchEvent !== "undefined" && ev instanceof TouchEvent ? ev.touches[0] : undefined
  return pivotOrigin(r, p)
}

/** MouseSensor + TouchSensor (not PointerSensor): a touch-held card drags only after 200ms, so swiping scrolls the page.
 *  Space lifts and drops; Enter stays "open the card". */
export function useDragSensors(coordinateGetter?: KeyboardCoordinateGetter) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  )
}

/** The lifted card leans into the drag like a held sheet of paper: horizontal speed → tilt, pivoting on the grab point.
 *  When the pointer stops (or the card is dropped) the speed falls to 0 and the spring settles it upright. */
export function LiftedCard({ className, origin, children }: { className: string; origin: string; children: ReactNode }) {
  const x = useMotionValue(0)
  const speed = useVelocity(x)
  const rotate = useSpring(useTransform(speed, [-TILT_SPEED, 0, TILT_SPEED], [-TILT_MAX, 0, TILT_MAX], { clamp: true }), TILT_SPRING)
  useDndMonitor({ onDragMove: ({ delta }) => x.set(delta.x) })
  return (
    <motion.div className={`${className} dnd-lifted`} style={{ rotate, transformOrigin: origin }}>
      {children}
    </motion.div>
  )
}

const noop = () => () => {}

/** The drag overlay, portalled to <body> (an animated ancestor, e.g. the page enter transform, would offset the fixed overlay from the
 *  pointer and skew collisions). Under reduced motion: a plain lifted card, no tilt and no drop animation. */
export function DragLayer({ show, reduce, className, origin, children }: { show: boolean; reduce: boolean; className: string; origin: string; children: ReactNode }) {
  const client = useSyncExternalStore(noop, () => true, () => false)
  if (!client) return null
  return createPortal(
    <DragOverlay dropAnimation={reduce ? null : DROP} modifiers={[zoomOverlay]}>
      {show && (reduce ? <div className={`${className} dnd-lifted`}>{children}</div> : <LiftedCard className={className} origin={origin}>{children}</LiftedCard>)}
    </DragOverlay>,
    document.body,
  )
}

/** Keyboard move for a board of drop targets (no sortable list): an arrow key jumps the held card to the nearest enabled target in that direction. */
export const moveBetweenTargets: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect } }) => {
  const dir = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as Record<string, [number, number]>)[event.code]
  if (!dir || !collisionRect) return
  event.preventDefault()
  const cx = collisionRect.left + collisionRect.width / 2
  const cy = collisionRect.top + collisionRect.height / 2
  let best: { x: number; y: number; score: number } | undefined
  for (const c of droppableContainers.getEnabled()) {
    const r = droppableRects.get(c.id)
    if (!r) continue
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    const along = dx * dir[0] + dy * dir[1]
    if (along <= 4) continue
    const score = along + Math.abs(dx * dir[1] + dy * dir[0]) * 2
    if (!best || score < best.score) best = { x: r.left + (r.width - collisionRect.width) / 2, y: r.top + 8, score }
  }
  return best && { x: best.x, y: best.y }
}
