// JS mirror of the CSS motion tokens in app/opsdesk.css (:root --dur-*, --ease). Seconds, for the `motion` library.
// Keep both in sync. Rules: .claude/docs/00-design-system/ui-rules.md → Motion.
export const DUR = { fast: 0.15, base: 0.22, slow: 0.32, count: 0.6 }
export const EASE = [0.2, 0.8, 0.2, 1] as const
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const

// Rows entering/leaving a filtered list
export const listItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE } },
}
export const layoutTransition = { duration: DUR.base, ease: EASE }

// ---- Wave A: action feedback, cascades, grow-from-trigger ----
// Gap between rows in a short top→bottom cascade (e.g. "Mark all read" clearing the unread dots).
export const STAGGER = 0.03
// ActionButton (components/action-button.tsx): how long the ✓ holds before the label returns. No minimum spinner time.
export const ACTION = { done: 0.7 }

// Direction a changed number rolls: "down" when it decreased, "up" otherwise (also for non-numeric values).
export function numDir(prev: string, next: string): "up" | "down" {
  const a = parseFloat(prev)
  const b = parseFloat(next)
  return Number.isFinite(a) && Number.isFinite(b) && b < a ? "down" : "up"
}

type Box = { left: number; top: number; width: number; height: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
// clip-path inset (px) that shows only the trigger's footprint inside the panel: the start (and end) of a panel
// growing out of its trigger. The footprint keeps the trigger's size but is clamped inside the panel.
export function growInset(trigger: Box, panel: Box) {
  const w = Math.min(trigger.width, panel.width)
  const h = Math.min(trigger.height, panel.height)
  const left = clamp(trigger.left - panel.left, 0, panel.width - w)
  const top = clamp(trigger.top - panel.top, 0, panel.height - h)
  return { top, right: panel.width - left - w, bottom: panel.height - top - h, left, radius: Math.min(w, h) / 2 }
}

// ---- Wave B: direction-aware slides (tabs, wizard steps, paged tables) ----
// "next" = the incoming panel enters from the right, "prev" = from the left. No change (or first render) = no slide.
// CSS: `.od-slide[data-slide]` in app/styles/settings.css. Reduced motion: covered by the global rule.
export type SlideDir = "next" | "prev"
export function slideDir(from: number, to: number): SlideDir | undefined {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || from < 0 || to < 0) return undefined
  return to > from ? "next" : "prev"
}
