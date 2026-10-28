"use client"

import { useEffect, useMemo, useState } from "react"
import { Pause, Play } from "lucide-react"

import { formatDuration, waveform } from "../logic"

// Mock voice-note player: play/pause and scrub over a deterministic waveform. No real audio until a provider exists.
export function VoicePlayer({ id, durationSec }: { id: string; durationSec: number }) {
  const bars = useMemo(() => waveform(id), [id])
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => {
      setPos((p) => {
        const next = p + 0.1
        if (next >= durationSec) {
          setPlaying(false)
          return 0
        }
        return next
      })
    }, 100)
    return () => window.clearInterval(t)
  }, [playing, durationSec])

  const played = pos / durationSec
  return (
    <div className="wa-voice">
      <button type="button" className="wa-play" aria-label={playing ? "Pause voice note" : "Play voice note"} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <div className="wa-wave">
        {/* Two identical bar layers: the brand-coloured one on top is clipped to the played fraction, so progress sweeps smoothly
            through the bars (clip-path, no width/layout change). */}
        <span className="wa-bars" aria-hidden="true">
          {bars.map((b, i) => (
            <i key={i} style={{ transform: `scaleY(${b})` }} />
          ))}
        </span>
        <span className="wa-bars wa-bars-on" aria-hidden="true" style={{ clipPath: `inset(0 ${(1 - played) * 100}% 0 0)` }}>
          {bars.map((b, i) => (
            <i key={i} style={{ transform: `scaleY(${b})` }} />
          ))}
        </span>
        <input
          type="range"
          className="wa-seek"
          min={0}
          max={durationSec}
          step={0.1}
          value={pos}
          aria-label="Seek voice note"
          aria-valuetext={`${formatDuration(pos)} of ${formatDuration(durationSec)}`}
          onChange={(e) => setPos(Number(e.target.value))}
        />
      </div>
      <span className="wa-dur num">{playing || pos > 0 ? formatDuration(pos) : formatDuration(durationSec)}</span>
    </div>
  )
}
