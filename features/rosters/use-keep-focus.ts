import { useEffect, useRef, type RefObject } from "react"

/**
 * Keyboard focus follows a card that moved to another column (M5). A card that changes parent is a new DOM node, so focus falls to the page; after `keep(id)` the card with that
 * `data-shift-id` takes focus back as soon as it is on screen again, but only when focus really is lost (on the page itself): a dialog that opened meanwhile keeps it, and the card gets it
 * after the dialog closes.
 */
export function useKeepFocus(root: RefObject<HTMLElement | null>) {
  const want = useRef<string | null>(null)
  useEffect(() => {
    const id = want.current
    const box = root.current
    if (!id || !box) return
    const el = [...box.querySelectorAll<HTMLElement>("[data-shift-id]")].find((x) => x.dataset.shiftId === id)?.querySelector<HTMLElement>(".ros-shift-btn")
    if (!el) return
    const now = document.activeElement
    if (now === el) { want.current = null; return }
    if (!now || now === document.body) {
      el.focus()
      want.current = null
    }
  })
  return (id: string) => { want.current = id }
}
