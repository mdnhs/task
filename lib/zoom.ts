// The Text size preset zooms <body> (lib/appearance.ts). getBoundingClientRect and pointer coordinates come back in
// on-screen px, while transforms and offsets set inside the zoomed body get zoomed again, so divide them back.

export const unzoom = (px: number, zoom: number | undefined) => (zoom && zoom !== 1 ? px / zoom : px)

/** The effective CSS zoom of an element (1 where the browser has no currentCSSZoom). */
export const cssZoom = (el: Element | null | undefined) => (el as (Element & { currentCSSZoom?: number }) | null)?.currentCSSZoom ?? 1

type Transform = { x: number; y: number; scaleX: number; scaleY: number }

/** @dnd-kit DragOverlay is fixed at the card's on-screen rect, and both that rect and the pointer delta get zoomed again
 *  inside <body>. Returns the transform that puts the overlay where the pointer is. */
export function unzoomOverlay(t: Transform, rect: { left: number; top: number }, zoom: number): Transform {
  if (!zoom || zoom === 1) return t
  return { ...t, x: (rect.left + t.x) / zoom - rect.left, y: (rect.top + t.y) / zoom - rect.top }
}
