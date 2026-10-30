// Tenant brand colour → OpsDesk brand tokens (FR-SAAS-11). Shared by the server layout and the branding panel's live preview.
// The default colour emits nothing, so the hand-tuned tokens in opsdesk.css stay exact.

export const DEFAULT_BRAND = "#2f7d52"
// The pre-calm-palette default: tenants that saved it get the current default tokens, not a vivid override.
const LEGACY_DEFAULTS = ["#1a8a3a"]
export const BRAND_STYLE_ID = "od-brand"
const HEX = /^#[0-9a-f]{6}$/i

const mix = (hex: string, pct: number, with_: string) => `color-mix(in oklab, ${hex} ${pct}%, ${with_})`

// Relative luminance decides the text colour on brand surfaces (white on dark brands, ink on light ones).
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function brandCss(hex: string | undefined): string {
  if (!hex || !HEX.test(hex) || hex.toLowerCase() === DEFAULT_BRAND || LEGACY_DEFAULTS.includes(hex.toLowerCase())) return ""
  const on = luminance(hex) > 0.45 ? "#14201a" : "#ffffff"
  const light = `--brand:${hex};--brand-2:${mix(hex, 80, "#fff")};--brand-3:${mix(hex, 62, "#fff")};--brand-deep:${mix(hex, 62, "#000")};--brand-soft:${mix(hex, 13, "#fff")};--stripe:${mix(hex, 40, "#fff")};--on-brand:${on}`
  const dark = `--brand:${mix(hex, 85, "#fff")};--brand-2:${mix(hex, 80, "#fff")};--brand-3:${mix(hex, 62, "#fff")};--brand-deep:${mix(hex, 55, "#000")};--brand-soft:${mix(hex, 26, "#101614")};--stripe:${mix(hex, 45, "#1a201d")}`
  // The sidebar promo card is dark in both themes, so its shades are theme-independent.
  const promo = `--promo-1:${mix(hex, 88, "#000")};--promo-2:${mix(hex, 35, "#000")};--promo-3:${mix(hex, 12, "#000")};--promo-ring:${mix(hex, 12, "transparent")};--promo-text:${mix(hex, 15, "#fff")};--promo-btn:${mix(hex, 90, "#fff")};--promo-btn-hover:${mix(hex, 78, "#fff")}`
  return `:root{${light};${promo}}:root[data-theme="dark"]{${dark}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`
}
