import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { DEFAULT_BRAND, brandCss, brandTokens } from "./brand"
import { DEFAULT_NEUTRALS_DARK, DEFAULT_NEUTRALS_LIGHT, mixOklab, tintNeutrals } from "./brand-neutrals"
import { LARGE_MIN, TEXT_MIN, audit, failures, minimums, type Tokens } from "./contrast"

// WCAG AA over every text token, both themes, the default green and tinted/derived brands (ui-rules.md → Contrast).
const css = readFileSync("app/opsdesk.css", "utf8")
const grab = (blk: string): Tokens => Object.fromEntries([...blk.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]))
const LIGHT = grab(css.slice(css.indexOf(":root{"), css.indexOf("@media (prefers-color-scheme:dark)")))
const DARK: Tokens = { ...LIGHT, ...grab(css.slice(css.indexOf(':root[data-theme="dark"]{'), css.indexOf("*{box-sizing"))) }

const withPromo = (t: Tokens): Tokens => ({ ...t, "promo-btn": mixOklab(t.brand, 90, "#ffffff"), "promo-btn-hover": mixOklab(t.brand, 78, "#ffffff") })
const defaults = (theme: "light" | "dark"): Tokens => withPromo(theme === "light" ? LIGHT : DARK)

/** Resolved tokens of a custom brand: default CSS values overridden exactly like brandCss does. */
function branded(brand: string, theme: "light" | "dark"): Tokens {
  const nl = tintNeutrals(DEFAULT_NEUTRALS_LIGHT, brand)
  const nd = tintNeutrals(DEFAULT_NEUTRALS_DARK, brand)
  const bt = brandTokens(brand, nl, nd)
  const t = theme === "light" ? { ...LIGHT, ...nl, ...bt.light } : { ...DARK, ...nd, ...bt.dark, "on-bad": nd.page }
  // The tinted promo block is theme independent (hex-based); the default promo mixes var(--brand) per theme.
  return { ...t, ...bt.promo, "promo-btn-ink": bt.promo["promo-btn-ink"] }
}

// Default green, the demo tenant (#3b5bdb), the brands the owner named and extremes.
export const BRANDS = ["#7c3aed", "#2563eb", "#dc2626", "#eab308", "#6b7280", "#3b5bdb", "#000000", "#ffffff", "#ff0000", "#00ffff", "#ffff00", "#808080", "#fefefe", "#010101", "#0000ff", "#00ff00", "#ff00ff", "#1a8a3a"]
const THEMES = ["light", "dark"] as const

describe("default theme: every text token reaches AA", () => {
  for (const theme of THEMES) {
    it(`${theme}: no failing pair`, () => {
      expect(failures(defaults(theme), theme).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}`)).toEqual([])
    })
  }
  it("the audit covers ink, ink-2, ink-3, placeholder, brand text, status text and on-brand", () => {
    const fgs = new Set(audit(defaults("light"), "light").map((r) => r.fg))
    for (const k of ["ink", "ink-2", "ink-3", "placeholder", "brand-text", "ok", "warn", "bad", "info", "on-brand", "on-bad", "brand-deep", "promo-btn-ink"]) expect(fgs.has(k), k).toBe(true)
    expect(Math.min(...audit(defaults("light"), "light").map((r) => r.min))).toBe(TEXT_MIN)
  })
  it("ink-3 is no longer lighter than the placeholder (both AA) and keeps its place below ink-2", () => {
    const m = minimums(defaults("light"), "light")
    expect(m["ink-3"].ratio).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(m["ink-3"].ratio).toBeLessThan(m["ink-2"].ratio)
  })
  it("fixed avatar colours in opsdesk.css are the audited ones", () => {
    for (const c of ["#ae6133", "#3c7d95"]) expect(css).toContain(c)
  })
})

describe("every brand: derived tokens reach AA in both themes", () => {
  for (const brand of BRANDS) {
    for (const theme of THEMES) {
      it(`${brand} ${theme}`, () => {
        expect(failures(branded(brand, theme), theme).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)}`)).toEqual([])
      })
    }
  }
  it("the default brand derives the same light fill, brand text and dark on-brand as opsdesk.css", () => {
    const bt = brandTokens(DEFAULT_BRAND, DEFAULT_NEUTRALS_LIGHT, DEFAULT_NEUTRALS_DARK)
    expect(bt.light.brand).toBe(LIGHT.brand)
    expect(bt.light["brand-text"]).toBe(LIGHT["brand-text"])
    expect(bt.dark["on-brand"]).toBe(DARK["on-brand"])
  })
  it("a light brand keeps its fill but gets a darker text colour (yellow)", () => {
    const nl = tintNeutrals(DEFAULT_NEUTRALS_LIGHT, "#eab308")
    const bt = brandTokens("#eab308", nl, tintNeutrals(DEFAULT_NEUTRALS_DARK, "#eab308"))
    expect(bt.light.brand).toBe("#eab308")
    expect(bt.light["brand-text"]).not.toBe("#eab308")
    expect(bt.light["on-brand"]).not.toBe("#ffffff")
  })
  it("brandCss emits the text tokens", () => {
    const out = brandCss("#eab308")
    for (const k of ["--brand-text:", "--on-brand:", "--promo-btn-ink:"]) expect(out).toContain(k)
  })
})

describe("non-text (icons, large text) uses the 3:1 floor", () => {
  it("brand-text and ink-3 icons clear 3:1 everywhere (they clear 4.5)", () => {
    for (const brand of BRANDS) for (const theme of THEMES) {
      const m = minimums(branded(brand, theme), theme)
      expect(m["brand-text"].ratio, `${brand} ${theme}`).toBeGreaterThanOrEqual(LARGE_MIN)
      expect(m["ink-3"].ratio).toBeGreaterThanOrEqual(LARGE_MIN)
    }
  })
})
