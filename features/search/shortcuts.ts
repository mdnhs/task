// Pure keyboard matchers for the global search, so they can be unit-tested without a DOM.

type Key = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean }
type TargetLike = { tagName?: string; isContentEditable?: boolean } | null

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** ⌘K on mac, Ctrl+K elsewhere (no Alt/Shift). */
export function isToggleShortcut(e: Key, mac: boolean): boolean {
  if (e.altKey || e.shiftKey || e.isComposing) return false
  if (e.key.toLowerCase() !== "k") return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

export function isTypingTarget(t: TargetLike): boolean {
  if (!t) return false
  if (t.isContentEditable) return true
  const tag = (t.tagName ?? "").toUpperCase()
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/** "/" focuses search, but never while the user is typing somewhere else. */
export function isSlashShortcut(e: Key, target: TargetLike): boolean {
  return e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !isTypingTarget(target)
}

/** Alt+F (Option+F) opens the filters. Uses `code` because Option+F types "ƒ" on mac. */
export function isFilterShortcut(e: Key): boolean {
  return e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyF" || e.key.toLowerCase() === "f")
}

/** ⌘Enter (mac) / Ctrl+Enter opens the highlighted link in a new tab. */
export function isNewTabEnter(e: Key, mac: boolean): boolean {
  return e.key === "Enter" && (mac ? e.metaKey : e.ctrlKey)
}

export const shortcutLabel = (mac: boolean) => (mac ? "⌘K" : "Ctrl K")
