"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ColorPicker as Ark, Portal, parseColor, type Color } from "@ark-ui/react"
import { cn } from "cn"

type Mode = "hex" | "rgb" | "hsl"

type Props = {
  /** 6-digit hex, e.g. #1b8a3a. Invalid values are ignored (the last valid colour stays). */
  value: string
  onValueChange: (hex: string) => void
  disabled?: boolean
  readOnly?: boolean
  invalid?: boolean
  id?: string
  presets?: string[]
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
  "aria-required"?: boolean
  className?: string
}

const subscribeNone = () => () => {}
const FALLBACK = "#1b8a3a"
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function toHex(c: Color) {
  return c.toString("hex").toLowerCase()
}

function tryParse(hex: string): Color | null {
  const v = hex.trim()
  if (!HEX_RE.test(v)) return null
  try {
    return parseColor(v.startsWith("#") ? v : `#${v}`).toFormat("hsba")
  } catch {
    return null
  }
}

const CHANNELS: Record<Exclude<Mode, "hex">, { key: string; label: string; max: number }[]> = {
  rgb: [
    { key: "red", label: "R", max: 255 },
    { key: "green", label: "G", max: 255 },
    { key: "blue", label: "B", max: 255 },
  ],
  hsl: [
    { key: "hue", label: "H", max: 360 },
    { key: "saturation", label: "S", max: 100 },
    { key: "lightness", label: "L", max: 100 },
  ],
}

function channelValues(color: Color, mode: Exclude<Mode, "hex">) {
  const c = color.toFormat(mode === "rgb" ? "rgba" : "hsla")
  return CHANNELS[mode].map((ch) => Math.round(c.getChannelValue(ch.key as never)))
}

function fromChannels(mode: Exclude<Mode, "hex">, v: number[]): Color | null {
  try {
    const str = mode === "rgb" ? `rgb(${v[0]}, ${v[1]}, ${v[2]})` : `hsl(${v[0]}, ${v[1]}%, ${v[2]}%)`
    return parseColor(str).toFormat("hsba")
  } catch {
    return null
  }
}

function ChannelField({ label, max, value, onCommit, disabled, readOnly }: { label: string; max: number; value: number; onCommit: (n: number) => void; disabled?: boolean; readOnly?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null) {
      const n = Number(draft)
      if (draft.trim() !== "" && Number.isFinite(n)) onCommit(Math.min(max, Math.max(0, Math.round(n))))
    }
    setDraft(null)
  }
  return (
    <label className="cp-chan">
      <input
        className="cp-input"
        inputMode="numeric"
        value={draft ?? String(value)}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit() } }}
      />
      <span className="cp-chan-l">{label}</span>
    </label>
  )
}

export function ColorPicker({ value, onValueChange, disabled, readOnly, invalid, id, presets, className, ...aria }: Props) {
  const [color, setColor] = useState<Color>(() => tryParse(value) ?? parseColor(FALLBACK).toFormat("hsba"))
  const [mode, setMode] = useState<Mode>("hex")
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const canPick = useSyncExternalStore(subscribeNone, () => "EyeDropper" in window, () => false)
  const last = useRef(toHex(color))

  // Sync from the parent only when it really changed (keeps hue when s/b hit 0 during dragging).
  useEffect(() => {
    const next = tryParse(value)
    if (next && toHex(next) !== last.current) {
      last.current = toHex(next)
      setColor(next)
    }
  }, [value])

  const apply = (c: Color) => {
    setColor(c)
    const hex = toHex(c)
    if (hex !== last.current) {
      last.current = hex
      onValueChange(hex)
    }
  }

  const hex = toHex(color)
  const inactive = disabled || readOnly
  const commitHex = () => {
    if (hexDraft !== null) {
      const c = tryParse(hexDraft)
      if (c) apply(c)
    }
    setHexDraft(null)
  }

  return (
    <Ark.Root
      className={cn("cp", className)}
      // The trigger's id goes through Ark's ids map: Ark finds its anchor by id, so an id set on the element itself breaks positioning.
      ids={id ? { trigger: id } : undefined}
      value={color}
      format="hsba"
      disabled={disabled}
      readOnly={readOnly}
      invalid={invalid}
      positioning={{ placement: "bottom-start", gutter: 6 }}
      onValueChange={(d) => apply(d.value)}
    >
      <Ark.Control className="cp-control">
        <Ark.Trigger className="cp-trigger" aria-label={aria["aria-label"] ?? "Pick colour"} aria-describedby={aria["aria-describedby"]} aria-invalid={aria["aria-invalid"]} aria-required={aria["aria-required"]} data-invalid={invalid ? "" : undefined}>
          <span className="cp-chip" style={{ background: hex }} aria-hidden="true" />
          <span className="cp-hex">{hex}</span>
        </Ark.Trigger>
      </Ark.Control>
      <Portal>
        <Ark.Positioner className="cp-positioner">
          <Ark.Content className="cp-pop">
            <Ark.Area className="cp-area" xChannel="saturation" yChannel="brightness">
              <Ark.AreaBackground className="cp-area-bg" />
              <Ark.AreaThumb className="cp-thumb" />
            </Ark.Area>

            <div className="cp-row">
              {canPick && !inactive && (
                <Ark.EyeDropperTrigger className="cp-icon-btn" aria-label="Pick colour from screen">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z" /></svg>
                </Ark.EyeDropperTrigger>
              )}
              <Ark.ChannelSlider className="cp-slider" channel="hue">
                <Ark.ChannelSliderTrack className="cp-track" />
                <Ark.ChannelSliderThumb className="cp-thumb cp-thumb-sm" />
              </Ark.ChannelSlider>
            </div>

            <div className="cp-modes" role="group" aria-label="Colour format">
              {(["hex", "rgb", "hsl"] as const).map((m) => (
                <button key={m} type="button" className="cp-mode" aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>
              ))}
            </div>

            {mode === "hex" ? (
              <label className="cp-chan cp-chan-hex">
                <input
                  className="cp-input"
                  aria-label="Hex colour"
                  spellCheck={false}
                  autoComplete="off"
                  value={hexDraft ?? hex}
                  disabled={disabled}
                  readOnly={readOnly}
                  onChange={(e) => setHexDraft(e.target.value.slice(0, 7))}
                  onBlur={commitHex}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitHex() } }}
                />
              </label>
            ) : (
              <div className="cp-chans">
                {channelValues(color, mode).map((n, i, all) => (
                  <ChannelField
                    key={CHANNELS[mode][i].key}
                    label={CHANNELS[mode][i].label}
                    max={CHANNELS[mode][i].max}
                    value={n}
                    disabled={disabled}
                    readOnly={readOnly}
                    onCommit={(nv) => {
                      const next = fromChannels(mode, all.map((x, j) => (j === i ? nv : x)))
                      if (next) apply(next)
                    }}
                  />
                ))}
              </div>
            )}

            {presets && presets.length > 0 && !inactive && (
              <Ark.SwatchGroup className="cp-swatches" aria-label="Colour presets">
                {presets.map((c) => (
                  <Ark.SwatchTrigger key={c} value={c} className="cp-swatch" aria-label={`Use ${c}`}>
                    <Ark.Swatch value={c} className="cp-swatch-fill">
                    <Ark.SwatchIndicator className="cp-swatch-check">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>
                    </Ark.SwatchIndicator>
                    </Ark.Swatch>
                  </Ark.SwatchTrigger>
                ))}
              </Ark.SwatchGroup>
            )}
          </Ark.Content>
        </Ark.Positioner>
      </Portal>
      <Ark.HiddenInput />
    </Ark.Root>
  )
}
