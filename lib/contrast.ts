// WCAG contrast audit for the OpsDesk colour tokens (ui-rules.md → Contrast). Pure: takes resolved #rrggbb token maps, so the unit test can run it
// over the default CSS and over every derived brand. A text token must reach 4.5:1 on every surface it is used on; non-text (icons, borders) 3:1.

import { contrastRatio } from "./brand-neutrals"

export type Tokens = Record<string, string>
export type Pair = { fg: string; bg: string; min: number }
export type Result = Pair & { ratio: number }

/** Surfaces text can sit on: page, the app shell, sidebar/topbar panels, cards and fields, muted fills, brand-soft chips and hover rows. */
export const SURFACES = ["page", "shell", "panel", "card", "mute-bg", "brand-soft"]
const STATUS = ["ok", "warn", "bad", "info"]
const FIXED_AVATARS = ["#2b7a4b", "#ae6133", "#5a5fb0", "#a2477a", "#3c7d95", "#7b6a2a"] // .av1-.av6 (white initials, theme independent)

export const TEXT_MIN = 4.5
export const LARGE_MIN = 3

/** Every (text token, background token) pair the UI renders, per theme. Hex literals are fixed colours that are not tokens. */
export function pairs(theme: "light" | "dark"): Pair[] {
  const out: Pair[] = []
  const on = (fg: string, bgs: string[], min = TEXT_MIN) => bgs.forEach((bg) => out.push({ fg, bg, min }))
  for (const fg of ["ink", "ink-2", "ink-3"]) on(fg, [...SURFACES, "line"]) // "line" = hover / open fill of icon buttons and the user menu trigger
  for (const fg of ["placeholder", "brand-text", ...STATUS]) on(fg, SURFACES)
  for (const s of STATUS) on(s, [`${s}-bg`]) // status chips (.st, .kind)
  on(theme === "light" ? "brand-deep" : "brand-3", SURFACES) // pill buttons, menu hover, tips, countdowns
  on("brand-deep", ["#ffffff"]) // sidebar promo chip icon (white disc, both themes)
  on("on-brand", ["brand", "hero-from", "hero-to"]) // buttons, selected tabs, badges, avatar, dashboard hero card
  on("on-bad", ["bad"]) // alert badge
  on("#ffffff", FIXED_AVATARS)
  on("promo-btn-ink", ["promo-btn", "promo-btn-hover"]) // sidebar promo button label
  return out
}

export function audit(t: Tokens, theme: "light" | "dark"): Result[] {
  const val = (k: string) => t[k] ?? k
  return pairs(theme).map((p) => ({ ...p, ratio: contrastRatio(val(p.fg), val(p.bg)) }))
}

export const failures = (t: Tokens, theme: "light" | "dark") => audit(t, theme).filter((r) => r.ratio < r.min)

/** The lowest ratio per text token (and the surface that gives it): the table the docs quote. */
export function minimums(t: Tokens, theme: "light" | "dark"): Record<string, { ratio: number; bg: string }> {
  const m: Record<string, { ratio: number; bg: string }> = {}
  for (const r of audit(t, theme)) if (!m[r.fg] || r.ratio < m[r.fg].ratio) m[r.fg] = { ratio: r.ratio, bg: r.bg }
  return m
}
