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
