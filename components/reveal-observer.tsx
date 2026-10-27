"use client"

import { useEffect } from "react"

// Elements whose enter animation should wait until they scroll into view. Add selectors here, not per component.
const REVEAL = ".progress"

// Mounted once in AppShell. Marks REVEAL elements with [data-inview] the first time they enter the viewport;
// CSS (opsdesk.css → Motion) holds their animation until then. Elements already on screen at mount are marked
// immediately, so they keep the animation they started on load and don't replay. Works for elements added later
// (route changes, dialogs) via a MutationObserver. Without JS, :root never gets [data-reveal], so nothing is held.
export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.setAttribute("data-inview", "")
          io.unobserve(e.target)
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    )
    const track = (el: Element, initial: boolean) => {
      if (el.hasAttribute("data-inview")) return
      const r = el.getBoundingClientRect()
      if (initial && r.top < innerHeight && r.bottom > 0) el.setAttribute("data-inview", "")
      else io.observe(el)
    }
    const scan = (n: Element, initial: boolean) => {
      if (n.matches(REVEAL)) track(n, initial)
      n.querySelectorAll(REVEAL).forEach((el) => track(el, initial))
    }

    scan(document.body, true)
    root.setAttribute("data-reveal", "")
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && scan(n, false))
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
      root.removeAttribute("data-reveal")
    }
  }, [])
  return null
}
