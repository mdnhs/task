// Workspace appearance presets (spec: .claude/docs/superpowers/specs/2026-10-30-appearance-presets-design.md).
// The admin picks one option per setting; each maps to a CSS scale token on :root. The middle option is the stock look
// and emits nothing, so the default stays byte-identical (same idea as brandCss for the default colour).

export type Corners = "sharp" | "soft" | "round"
export type TextSize = "small" | "default" | "large"
export type Spacing = "compact" | "comfortable" | "spacious"
export type Appearance = { corners: Corners; text: TextSize; spacing: Spacing }

type Opt<T> = { value: T; label: string; scale: number }

export const DEFAULT_APPEARANCE: Appearance = { corners: "soft", text: "default", spacing: "comfortable" }

export const APPEARANCE_OPTIONS: { corners: Opt<Corners>[]; text: Opt<TextSize>[]; spacing: Opt<Spacing>[] } = {
  corners: [
    { value: "sharp", label: "Sharp", scale: 0.4 },
    { value: "soft", label: "Soft", scale: 1 },
    { value: "round", label: "Round", scale: 1.4 },
  ],
  text: [
    { value: "small", label: "Small", scale: 0.92 },
    { value: "default", label: "Default", scale: 1 },
    { value: "large", label: "Large", scale: 1.1 },
  ],
  spacing: [
    { value: "compact", label: "Compact", scale: 0.75 },
    { value: "comfortable", label: "Comfortable", scale: 1 },
    { value: "spacious", label: "Spacious", scale: 1.3 },
  ],
}

const TOKENS = { corners: "--radius-scale", text: "--text-scale", spacing: "--space-scale" } as const
const KEYS = ["corners", "text", "spacing"] as const

const pick = <T extends string>(opts: Opt<T>[], v: unknown, fallback: T): T => opts.find((o) => o.value === v)?.value ?? fallback

/** Anything from a cookie or a form: unknown or missing fields fall back to the default, field by field. */
export function parseAppearance(raw: unknown): Appearance {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    corners: pick(APPEARANCE_OPTIONS.corners, r.corners, DEFAULT_APPEARANCE.corners),
    text: pick(APPEARANCE_OPTIONS.text, r.text, DEFAULT_APPEARANCE.text),
    spacing: pick(APPEARANCE_OPTIONS.spacing, r.spacing, DEFAULT_APPEARANCE.spacing),
  }
}

/** The :root rule for the non-default scales ("" when everything is the default). */
export function appearanceCss(a: Appearance): string {
  const decls = KEYS.flatMap((k) => {
    const scale = (APPEARANCE_OPTIONS[k] as Opt<string>[]).find((o) => o.value === a[k])?.scale ?? 1
    return scale === 1 ? [] : [`${TOKENS[k]}:${scale}`]
  })
  return decls.length ? `:root{${decls.join(";")}}` : ""
}

/** Inline radius for skeleton blocks (components/sk.tsx): px radii follow the Corners preset like the real UI. */
export const scaledRadius = (r: number | "pill" | "circle" | undefined) =>
  r === "pill" ? 999 : r === "circle" ? "50%" : r === undefined ? undefined : `calc(${r}px * var(--radius-scale,1))`
