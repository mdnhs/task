// Is `target` inside the search area: the search root (input + popover) or one of its own portalled popups
// (filter Select lists, date-range calendar), which carry LAYER_ATTR. Pure, so it can be tested without a DOM.
export const LAYER_ATTR = "data-od-search-layer"

type RootLike = { contains(n: unknown): boolean } | null | undefined
type TargetLike = { closest?: (sel: string) => unknown } | null | undefined

export function isInsideSearch(target: TargetLike, root: RootLike): boolean {
  if (!target) return false
  if (root?.contains(target)) return true
  return typeof target.closest === "function" && !!target.closest(`[${LAYER_ATTR}]`)
}
