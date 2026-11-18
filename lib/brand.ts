// Tenant brand colour → OpsDesk brand tokens (FR-SAAS-11). Shared by the server layout and the branding panel's live preview.
// The default colour emits nothing, so the hand-tuned tokens in opsdesk.css stay exact.
//
// Contrast (ui-rules.md → Contrast): every text colour reaches 4.5:1 on every surface it sits on, for any brand. The brand colour
// itself is kept for fills; the colour used for TEXT (--brand-text, --brand-deep, dark --brand-3) and the text on a brand fill
// (--on-brand) are derived from it, changing only lightness. lib/contrast.test.ts enforces this over many brands.

import {
  DEFAULT_NEUTRALS_DARK, DEFAULT_NEUTRALS_LIGHT, DEFAULT_STATUS_DARK, DEFAULT_STATUS_LIGHT, cssVars, contrastRatio, ensureContrast, mixOklab, tintNeutrals, tintShadow, type NeutralTokens,
} from "./brand-neutrals"

export const DEFAULT_BRAND = "#1a8a3a"
export const BRAND_STYLE_ID = "od-brand"
const HEX = /^#[0-9a-f]{6}$/i
const AA = 4.6 // 4.5 plus a little room for hex rounding

const mix = (hex: string, pct: number, with_: string) => `color-mix(in oklab, ${hex} ${pct}%, ${with_})`
const SURFACES = ["page", "shell", "panel", "card", "mute-bg"] as const

/** White text if it reaches AA on `fill`, else the darker candidate, else black (one of them always passes). */
function textOn(fill: string, dark: string): string {
  if (contrastRatio("#ffffff", fill) >= AA) return "#ffffff"
  return contrastRatio(dark, fill) >= AA ? dark : "#000000"
}

export type BrandTokens = { light: Record<string, string>; dark: Record<string, string>; promo: Record<string, string> }

/** The contrast-sensitive brand tokens (hex) for a brand over a neutral scale. Fills keep the brand; text variants move lightness only. */
export function brandTokens(hex: string, nl: NeutralTokens, nd: NeutralTokens): BrandTokens {
  // Light: a fill that white text nearly reaches AA on (4.0 to 4.6) is darkened just enough; lighter brands get dark text instead.
  const lw = contrastRatio("#ffffff", hex)
  const fillL = lw < AA && lw >= 4.0 ? ensureContrast(hex, ["#ffffff"], AA, "darker") : hex
  // brand-soft (chips, hover rows) stays light enough for the grey and status text that sits on it.
  const textsL = [nl["ink-3"], nl.placeholder, ...Object.values(DEFAULT_STATUS_LIGHT)]
  const softL = ensureContrast(mixOklab(hex, 13, "#ffffff"), textsL, AA, "lighter")
  const surfL = [...SURFACES.map((k) => nl[k]), softL]
  const light = {
    brand: fillL,
    "brand-text": ensureContrast(fillL, surfL, AA, "darker"),
    "brand-deep": ensureContrast(mixOklab(hex, 62, "#000000"), [...surfL, "#ffffff"], AA, "darker"),
    "brand-soft": softL,
    "on-brand": textOn(fillL, nl.ink),
  }
  // Dark: the brand lifted toward white; text variants lighter, text on the fill dark where white does not reach AA.
  const fillD = mixOklab(hex, 85, "#ffffff")
  const textsD = [nd["ink-3"], nd.placeholder, ...Object.values(DEFAULT_STATUS_DARK)]
  const softD = ensureContrast(mixOklab(hex, 26, nd.page), textsD, AA, "darker")
  const surfD = [...SURFACES.map((k) => nd[k]), softD]
  const dark = {
    brand: fillD,
    "brand-text": ensureContrast(fillD, surfD, AA, "lighter"),
    "brand-3": ensureContrast(mixOklab(hex, 62, "#ffffff"), surfD, AA, "lighter"),
    "brand-soft": softD,
    "on-brand": textOn(fillD, nd.page),
  }
  // Sidebar promo button: label white or the dark page colour, whichever suits; if neither reaches AA on the button and its
  // (lighter) hover, the button moves in lightness (not hue) until it does.
  let pb = mixOklab(hex, 90, "#ffffff")
  let pbh = mixOklab(hex, 78, "#ffffff")
  const score = (ink: string) => Math.min(contrastRatio(ink, pb), contrastRatio(ink, pbh))
  const ink = score("#ffffff") >= score(nd.page) ? "#ffffff" : nd.page
  const dir = ink === "#ffffff" ? "darker" : "lighter"
  pb = ensureContrast(pb, [ink], AA, dir)
  pbh = ensureContrast(pbh, [ink], AA, dir)
  const promo = { "promo-btn": pb, "promo-btn-hover": pbh, "promo-btn-ink": ink }
  // Dashboard hero card: gradient from a darker to a lighter shade of the brand with the on-brand label on top. The end stops move in
  // lightness (not hue) only as far as the label needs; the glass behind small pills goes the other way, away from the label.
  const hero = (on: string) => {
    const dirH = on === "#ffffff" ? "darker" : "lighter"
    return {
      from: ensureContrast(mixOklab(hex, 82, "#000000"), [on], AA, dirH),
      to: ensureContrast(mixOklab(hex, 62, "#ffffff"), [on], AA, dirH),
      patch: on === "#ffffff" ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.22)",
    }
  }
  const hl = hero(light["on-brand"])
  const hd = hero(dark["on-brand"])
  Object.assign(light, { "hero-from": hl.from, "hero-to": hl.to, "hero-patch": hl.patch })
  Object.assign(dark, { "hero-from": hd.from, "hero-to": hd.to, "hero-patch": hd.patch })
  return { light, dark, promo }
}

export function brandCss(hex: string | undefined): string {
  if (!hex || !HEX.test(hex) || hex.toLowerCase() === DEFAULT_BRAND) return ""
  // Neutral surfaces take a faint tint of the brand hue (same luminance, so contrast is unchanged): lib/brand-neutrals.ts.
  const nl = tintNeutrals(DEFAULT_NEUTRALS_LIGHT, hex)
  const nd = tintNeutrals(DEFAULT_NEUTRALS_DARK, hex)
  const bt = brandTokens(hex, nl, nd)
  const sh = tintShadow(hex)
  const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(sh.slice(i, i + 2), 16))
  const shadow = `--shadow:0 1px 2px rgba(${sr},${sg},${sb},.035),0 8px 24px rgba(${sr},${sg},${sb},.045)`
  const light = `${cssVars(nl)};${shadow};${cssVars(bt.light)};--brand-2:${mix(hex, 80, "#fff")};--brand-3:${mix(hex, 62, "#fff")};--stripe:${mix(hex, 40, "#fff")}`
  const dark = `${cssVars(nd)};${cssVars(bt.dark)};--brand-2:${mix(hex, 80, "#fff")};--brand-deep:${mix(hex, 55, "#000")};--stripe:${mix(hex, 45, nd.panel)};--on-bad:${nd.page}`
  // The sidebar promo card is dark in both themes, so its shades are theme-independent.
  const promo = `--promo-1:${mix(hex, 88, "#000")};--promo-2:${mix(hex, 35, "#000")};--promo-3:${mix(hex, 12, "#000")};--promo-ring:${mix(hex, 12, "transparent")};--promo-text:${mix(hex, 15, "#fff")};--promo-btn:${bt.promo["promo-btn"]};--promo-btn-hover:${bt.promo["promo-btn-hover"]};--promo-btn-ink:${bt.promo["promo-btn-ink"]}`
  return `:root{${light};${promo}}:root[data-theme="dark"]{${dark}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`
}
