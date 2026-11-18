// Brand-tinted neutral surfaces. The default neutral scale (opsdesk.css) is a green-grey; for a custom brand colour every neutral keeps
// its exact relative luminance (so contrast ratios are unchanged) and only its hue and chroma move: hue follows the brand, chroma is the
// token's own (already tiny) chroma scaled by how colourful the brand is, so a loud brand never makes loud neutrals and a grey brand
// gives pure greys. Pure functions, no DOM: shared by the server layout (no flash on first paint) and the Branding live preview.

export type NeutralTokens = Record<string, string>

// The default scale, mirrored from :root / dark :root in app/opsdesk.css (a test keeps both in step).
export const DEFAULT_NEUTRALS_LIGHT: NeutralTokens = {
  page: "#e8ebe6", shell: "#f5f6f2", panel: "#eef1eb", card: "#fcfdfa", ink: "#1f2a24", "ink-2": "#56625b", "ink-3": "#5d6661",
  placeholder: "#606b65", line: "#e0e5dd", "mute-bg": "#eef0ea",
}
export const DEFAULT_NEUTRALS_DARK: NeutralTokens = {
  page: "#111614", shell: "#161c19", panel: "#1a211d", card: "#1f2722", ink: "#e2e8e3", "ink-2": "#a9b5ad", "ink-3": "#94a198",
  placeholder: "#95a199", line: "#2a332e", "mute-bg": "#252d29",
}
// Status text colours, mirrored from the same blocks (not tinted; brand-soft is darkened/lightened so they stay readable on it).
export const DEFAULT_STATUS_LIGHT: NeutralTokens = { ok: "#14783b", warn: "#905e07", bad: "#aa4845", info: "#406b98" }
export const DEFAULT_STATUS_DARK: NeutralTokens = { ok: "#7cc49b", warn: "#d6a865", bad: "#dc8b85", info: "#90b2d8" }
// Light shadow colour (rgb 30,50,38) as hex so it is tinted the same way.
export const DEFAULT_SHADOW_RGB = "#1e3226"
export const DEFAULT_BRAND_HUE = 147 // hue of the default brand #1a8a3a in OKLCH; tokens keep their offset from it
const CHROMA_FULL = 0.1 // brand chroma at which neutrals get their full (default-sized) chroma
const CHROMA_FLOOR = 0.015 // at or below this the brand reads as grey: neutrals go grey

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const unlin = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const toLinear = (hex: string): [number, number, number] => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
const lumaOf = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

export function toOklch(hex: string): { L: number; C: number; h: number } {
  const [r, g, b] = toLinear(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.0005 && c <= 1.0005)
const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, unlin(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, "0")).join("")

/** Same relative luminance as `hex`, new hue, chroma `C` (reduced until the colour fits sRGB). */
export function retint(hex: string, hue: number, C: number): string {
  const target = lumaOf(toLinear(hex))
  let chroma = C
  for (let tries = 0; tries < 40; tries++) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (lumaOf(oklchToLinear(mid, chroma, hue)) < target) lo = mid
      else hi = mid
    }
    const rgb = oklchToLinear((lo + hi) / 2, chroma, hue)
    if (inGamut(rgb)) return toHex(rgb)
    chroma *= 0.85
  }
  return toHex(oklchToLinear(toOklch(hex).L, 0, 0))
}

/** Colour with OKLCH lightness `L` (hue kept; chroma kept, reduced until it fits sRGB). */
export function withLightness(hex: string, L: number): string {
  const { C, h } = toOklch(hex)
  let chroma = C
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToLinear(L, chroma, h)
    if (inGamut(rgb)) return toHex(rgb)
    chroma *= 0.92
  }
  return toHex(oklchToLinear(L, 0, 0))
}

/** WCAG 2.x relative luminance and contrast ratio of #rrggbb colours. */
export const relLuminance = (hex: string) => lumaOf(toLinear(hex))
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** CSS `color-mix(in oklab, a pct%, b)` resolved to a hex (opaque #rrggbb inputs). */
export function mixOklab(a: string, pct: number, b: string): string {
  const lab = (hex: string) => {
    const { L, C, h } = toOklch(hex)
    return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
  }
  const [la, aa, ba] = lab(a)
  const [lb, ab, bb] = lab(b)
  const t = pct / 100
  const A = aa * t + ab * (1 - t)
  const B = ba * t + bb * (1 - t)
  return toHex(oklchToLinear(la * t + lb * (1 - t), Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360))
}

/**
 * Only the lightness of `hex` changes (hue and chroma kept) until it reaches `min`:1 against every colour in `bgs`.
 * `dir` is the way to move: "darker" for text on light surfaces, "lighter" on dark ones. Returns `hex` untouched if it already passes.
 */
export function ensureContrast(hex: string, bgs: string[], min: number, dir: "darker" | "lighter"): string {
  const worst = (c: string) => Math.min(...bgs.map((bg) => contrastRatio(c, bg)))
  if (worst(hex) >= min) return hex
  let L = toOklch(hex).L
  const step = dir === "darker" ? -0.002 : 0.002
  for (let i = 0; i < 600; i++) {
    L += step
    if (L <= 0 || L >= 1) break
    const c = withLightness(hex, L)
    if (worst(c) >= min) return c
  }
  return dir === "darker" ? "#000000" : "#ffffff"
}

/** 0 for greys, 1 for any clearly coloured brand (a loud brand is capped, never louder than the default scale). */
export function brandChromaFactor(hex: string): number {
  const { C } = toOklch(hex)
  return Math.min(1, Math.max(0, (C - CHROMA_FLOOR) / (CHROMA_FULL - CHROMA_FLOOR)))
}

export function tintNeutrals(scale: NeutralTokens, brand: string): NeutralTokens {
  const { h } = toOklch(brand)
  const k = brandChromaFactor(brand)
  return Object.fromEntries(
    Object.entries(scale).map(([name, hex]) => {
      const t = toOklch(hex)
      const hue = (h + (t.h - DEFAULT_BRAND_HUE) + 360) % 360
      return [name, retint(hex, hue, t.C * k)]
    }),
  )
}

export const cssVars = (t: NeutralTokens) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";")

/** Hex of the light-theme shadow tint for a brand. */
export function tintShadow(brand: string): string {
  const t = toOklch(DEFAULT_SHADOW_RGB)
  return retint(DEFAULT_SHADOW_RGB, (toOklch(brand).h + (t.h - DEFAULT_BRAND_HUE) + 360) % 360, t.C * brandChromaFactor(brand))
}
