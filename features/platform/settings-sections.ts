// Platform settings sections (vertical tabs on /platform/settings). The URL carries the selection (?section=email), the server page reads it, so the first paint is already right.
export const SETTINGS_SECTIONS = [
  { id: "email", label: "Email", icon: "mail" },
  { id: "storage", label: "File storage", icon: "folder" },
  { id: "billing", label: "Billing", icon: "wallet" },
] as const satisfies readonly { id: string; label: string; icon: string }[]

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"]
export const DEFAULT_SECTION: SettingsSection = "email"

/** Any value from the URL -> a valid section (unknown, missing or repeated values fall back to the first). */
export function parseSection(v: string | string[] | null | undefined): SettingsSection {
  const s = Array.isArray(v) ? v[0] : v
  return SETTINGS_SECTIONS.find((x) => x.id === s)?.id ?? DEFAULT_SECTION
}

export const sectionHref = (pathname: string, s: SettingsSection) => (s === DEFAULT_SECTION ? pathname : `${pathname}?section=${s}`)

/** Roving-tabindex target for a key press on the tab list (arrows in both orientations wrap, Home/End jump). Null = not a navigation key. */
export function nextSection(current: SettingsSection, key: string): SettingsSection | null {
  const i = SETTINGS_SECTIONS.findIndex((x) => x.id === current)
  const n = SETTINGS_SECTIONS.length
  if (key === "ArrowDown" || key === "ArrowRight") return SETTINGS_SECTIONS[(i + 1) % n].id
  if (key === "ArrowUp" || key === "ArrowLeft") return SETTINGS_SECTIONS[(i - 1 + n) % n].id
  if (key === "Home") return SETTINGS_SECTIONS[0].id
  if (key === "End") return SETTINGS_SECTIONS[n - 1].id
  return null
}
