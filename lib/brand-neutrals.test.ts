import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DEFAULT_BRAND, brandCss } from "./brand"
import {
  DEFAULT_NEUTRALS_DARK, DEFAULT_NEUTRALS_LIGHT, DEFAULT_STATUS_DARK, DEFAULT_STATUS_LIGHT, brandChromaFactor, retint, tintNeutrals, toOklch, type NeutralTokens,
} from "./brand-neutrals"

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const Y = (hex: string) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a: string, b: string) => {
  const [hi, lo] = [Y(a), Y(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const BRANDS = ["#7c3aed", "#2563eb", "#dc2626", "#eab308", "#6b7280", "#ff0000", "#00ffff", "#ffff00", "#000000", "#ffffff", "#fefefe", "#010101"]
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe("neutral derivation", () => {
  it("extracts the brand hue (OKLCH)", () => {
    expect(hueDist(toOklch("#7c3aed").h, 293)).toBeLessThan(2)
    expect(hueDist(toOklch(DEFAULT_BRAND).h, 147)).toBeLessThan(2)
  })
  it("tints neutrals toward the brand hue", () => {
    const t = tintNeutrals(DEFAULT_NEUTRALS_LIGHT, "#2563eb")
    expect(hueDist(toOklch(t.card).h, toOklch("#2563eb").h)).toBeLessThan(40)
    expect(parseInt(t.page.slice(5, 7), 16)).toBeGreaterThan(parseInt(t.page.slice(1, 3), 16))
  })
  it("keeps each neutral's luminance (contrast unchanged) and its chroma at or below the default", () => {
    for (const brand of BRANDS) {
      for (const scale of [DEFAULT_NEUTRALS_LIGHT, DEFAULT_NEUTRALS_DARK]) {
        const t = tintNeutrals(scale, brand)
        for (const k of Object.keys(scale)) {
          expect(Math.abs(Y(t[k]) - Y(scale[k]))).toBeLessThan(0.007)
          expect(toOklch(t[k]).C).toBeLessThanOrEqual(toOklch(scale[k]).C + 0.003)
        }
      }
    }
  })
  it("caps a very saturated brand at the default chroma", () => {
    for (const b of ["#ff0000", "#00ffff", "#ffff00"]) expect(brandChromaFactor(b)).toBe(1)
  })
  it("greys and near-greys give grey or almost-grey neutrals", () => {
    for (const brand of ["#808080", "#000000", "#ffffff", "#777777"]) {
      expect(brandChromaFactor(brand)).toBe(0)
      for (const v of Object.values(tintNeutrals(DEFAULT_NEUTRALS_LIGHT, brand))) expect(toOklch(v).C).toBeLessThan(0.004)
    }
    expect(brandChromaFactor("#6b7280")).toBeLessThan(0.2)
  })
  it("handles extreme-lightness brands without invalid output", () => {
    for (const brand of ["#fefefe", "#010101", "#ffff00", "#0000ff"]) {
      for (const scale of [DEFAULT_NEUTRALS_DARK, DEFAULT_NEUTRALS_LIGHT]) {
        for (const v of Object.values(tintNeutrals(scale, brand))) expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
    expect(retint("#fcfdfa", 90, 0.5)).toMatch(/^#[0-9a-f]{6}$/)
  })
  it("default green brand emits nothing, so the hand-tuned tokens are identical", () => {
    expect(brandCss(DEFAULT_BRAND)).toBe("")
    expect(brandCss(DEFAULT_BRAND.toUpperCase())).toBe("")
    expect(brandCss(undefined)).toBe("")
  })
  it("a custom brand emits every neutral token for light and dark", () => {
    const css = brandCss("#7c3aed")
    for (const k of Object.keys(DEFAULT_NEUTRALS_LIGHT)) expect(css).toContain(`--${k}:#`)
    expect(css).toContain("--shadow:")
    expect(css).toContain('[data-theme="dark"]')
  })
})

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next") continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx?)$/.test(n)) out.push(p)
  }
  return out
}

describe("neutral tokens in opsdesk.css", () => {
  const css = readFileSync("app/opsdesk.css", "utf8")
  const grab = (block: string, scale: NeutralTokens) => {
    for (const [k, v] of Object.entries(scale)) expect(block, `--${k}`).toMatch(new RegExp(`--${k}:\\s*${v}\\b`, "i"))
  }
  it("light and dark default definitions match the TS defaults (single source for the tint)", () => {
    grab(css.slice(css.indexOf(":root{"), css.indexOf("@media (prefers-color-scheme:dark)")), DEFAULT_NEUTRALS_LIGHT)
    grab(css.slice(css.indexOf(':root[data-theme="dark"]{'), css.indexOf("*{box-sizing")), DEFAULT_NEUTRALS_DARK)
  })
  it("status text colours mirror the TS defaults (brand-soft is kept readable against them)", () => {
    grab(css.slice(css.indexOf(":root{"), css.indexOf("@media (prefers-color-scheme:dark)")), DEFAULT_STATUS_LIGHT)
    grab(css.slice(css.indexOf(':root[data-theme="dark"]{'), css.indexOf("*{box-sizing")), DEFAULT_STATUS_DARK)
  })
  it("no other stylesheet or component hard-codes a default green neutral hex", () => {
    const hexes = [...Object.values(DEFAULT_NEUTRALS_LIGHT), ...Object.values(DEFAULT_NEUTRALS_DARK)]
    const files = ["app", "features", "components", "lib", "hooks"].flatMap((d) => walk(d))
      .filter((f) => !/opsdesk\.css$|global-error\.tsx$|brand-neutrals|\.test\./.test(f))
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase()
      for (const h of hexes) expect(text.includes(h), `${f} has ${h}`).toBe(false)
    }
  })
})

describe("contrast over brands", () => {
  const PAIRS: [string, string][] = [["ink", "page"], ["ink", "card"], ["ink", "panel"], ["ink", "shell"], ["ink-2", "card"], ["ink-2", "panel"], ["ink-2", "page"], ["ink-3", "card"], ["ink-3", "panel"], ["placeholder", "card"], ["placeholder", "panel"], ["ink", "mute-bg"], ["ink-2", "mute-bg"]]
  it("every text/surface pair keeps its default contrast ratio", () => {
    for (const brand of BRANDS) {
      for (const scale of [DEFAULT_NEUTRALS_LIGHT, DEFAULT_NEUTRALS_DARK]) {
        const t = tintNeutrals(scale, brand)
        for (const [fg, bg] of PAIRS) expect(ratio(t[fg], t[bg])).toBeGreaterThan(ratio(scale[fg], scale[bg]) * 0.98)
      }
    }
  })
})
