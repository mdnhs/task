"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { Switch } from "@/components/ui/switch"
import { VOICE_LEAD, type VoiceNote } from "@/lib/task-voice"
import { taskSpeech } from "@/lib/today"
import type { DayItem, DayMode, DaySummary } from "@/lib/today"

// "Play my day" (FR-M1-73..75, FR-M1-77): the browser speech engine reads the summary, then each task. Compact bar; the
// motion is only colour/opacity transitions, which the global reduced-motion rule switches off. A task with voice instructions
// (lib/task-voice.ts) is read, then "Voice instructions:" and the recording plays at the player's speed; pause, next, previous,
// repeat, a speed change and closing all stop it (the effect cleanup).

export const SPEEDS = [0.75, 1, 1.25, 1.5] as const

const NO_VOICE: Record<string, VoiceNote> = {}
const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
const noop = () => () => {}

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none" aria-hidden="true">{children}</svg>
)
const IPlay = () => <Svg><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></Svg>
const IPause = () => <Svg><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></Svg>
const INext = () => <Svg><path d="M6 6.4v11.2a.8.8 0 0 0 1.25.66l8-5.6a.8.8 0 0 0 0-1.32l-8-5.6A.8.8 0 0 0 6 6.4Z" /><rect x="17" y="5.5" width="2.4" height="13" rx="1.1" /></Svg>
const IPrev = () => <Svg><path d="M18 6.4v11.2a.8.8 0 0 1-1.25.66l-8-5.6a.8.8 0 0 1 0-1.32l8-5.6A.8.8 0 0 1 18 6.4Z" /><rect x="4.6" y="5.5" width="2.4" height="13" rx="1.1" /></Svg>
const IRepeat = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
)

export function TodayPlayer({
  items,
  voice = NO_VOICE,
  summary,
  now,
  mode,
  autoplay,
  onMode,
  onDone,
  onSnooze,
  onOpen,
  onClose,
}: {
  items: DayItem[]
  /** Voice instructions by task ref (this session's recordings). */
  voice?: Record<string, VoiceNote>
  summary: DaySummary
  now: string
  mode: DayMode
  /** Start talking at once (the "Play my day" press). */
  autoplay: boolean
  onMode: (m: DayMode) => void
  onDone: (item: DayItem) => void
  onSnooze: (item: DayItem) => void
  onOpen: (item: DayItem) => void
  onClose: () => void
}) {
  const supported = useSyncExternalStore(noop, speechSupported, () => true)
  const [pos, setPos] = useState(0) // 0 = the summary, n = the nth task
  const [playing, setPlaying] = useState(autoplay)
  const [rate, setRate] = useState<number>(1)
  const [nonce, setNonce] = useState(0) // bumped by "repeat" to restart the same segment

  const segments = useMemo(
    () => [summary.spoken, ...items.map((it, i) => taskSpeech(it, i + 1, items.length, now) + (voice[it.task.ref] ? ` ${VOICE_LEAD}` : ""))],
    [summary, items, now, voice],
  )
  const at = Math.min(pos, segments.length - 1)
  const current = at > 0 ? items[at - 1] : undefined
  const note = current ? voice[current.task.ref] : undefined
  // Which run of the effect is playing the recording now (so the label clears on its own when the segment changes).
  const run = `${at}|${nonce}|${rate}|${playing}`
  const [voiceRun, setVoiceRun] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    synth.cancel()
    if (!playing) return
    let live = true
    let audio: HTMLAudioElement | null = null
    const next = () => {
      if (!live) return
      setVoiceRun(null)
      if (at + 1 < segments.length) setPos(at + 1)
      else {
        setPlaying(false)
        setPos(0)
      }
    }
    const u = new SpeechSynthesisUtterance(segments[at])
    u.rate = rate
    u.onend = () => {
      if (!live) return
      if (!note) return next()
      audio = new Audio(note.url)
      audio.playbackRate = rate
      audio.onended = next
      audio.onerror = next
      setVoiceRun(run)
      audio.play().catch(next)
    }
    u.onerror = () => {
      if (live) setPlaying(false)
    }
    synth.speak(u)
    return () => {
      live = false
      synth.cancel()
      setVoiceRun(null)
      if (audio) {
        audio.onended = audio.onerror = null
        audio.pause()
        audio = null
      }
    }
  }, [supported, playing, at, rate, segments, nonce, note, run])

  // Leaving the page or closing the bar stops the voice (the effect cleanup above cancels; this covers the unmount order).
  useEffect(() => () => void (speechSupported() && window.speechSynthesis.cancel()), [])

  const go = (to: number) => setPos(Math.max(0, Math.min(segments.length - 1, to)))
  const label = current ? `Task ${at} of ${items.length}` : "Summary"

  if (!supported)
    return (
      <div className="td-player" role="status">
        <div className="td-now">
          <div className="td-pos">Read aloud is not available</div>
          <div className="td-meta">This browser has no speech engine. Use Summarise my day to read your list instead.</div>
        </div>
        <button type="button" className="pill-btn" onClick={onClose}>Close</button>
      </div>
    )

  return (
    <div className="td-player" role="group" aria-label="Play my day">
      <div className="td-now" aria-live="polite">
        <div className="td-pos">{label}</div>
        <div className="td-title">{current ? current.task.title : summary.headline}</div>
        <div className="td-meta">
          {current ? `${current.task.ref} · ${voiceRun === run ? "Playing voice instructions" : note ? `${current.reason} · voice instructions` : current.reason}` : items.length ? `${items.length} to go through` : "Nothing left to read"}
        </div>
      </div>
      <div className="td-ctl">
        <button type="button" className="td-ib" aria-label="Previous" onClick={() => go(at - 1)} disabled={at === 0}><IPrev /></button>
        <button type="button" className="td-ib td-play" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>{playing ? <IPause /> : <IPlay />}</button>
        <button type="button" className="td-ib" aria-label="Next" onClick={() => go(at + 1)} disabled={at >= segments.length - 1}><INext /></button>
        <button type="button" className="td-ib" aria-label="Repeat" onClick={() => setNonce((n) => n + 1)}><IRepeat /></button>
      </div>
      <div className="td-speed" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" className="td-sp" aria-pressed={rate === s} onClick={() => setRate(s)}>{s}x</button>
        ))}
      </div>
      <label className="td-only">
        <Switch size="sm" checked={mode === "high-and-overdue"} onCheckedChange={(on) => { onMode(on ? "high-and-overdue" : "all"); setPos(0) }} aria-label="High and overdue only" />
        <span>High and overdue only</span>
      </label>
      <div className="td-acts">
        <button type="button" className="pill-btn" disabled={!current} onClick={() => current && onDone(current)}>Mark done</button>
        <button type="button" className="pill-btn" disabled={!current} onClick={() => current && onSnooze(current)}>Snooze</button>
        <button type="button" className="pill-btn" disabled={!current} onClick={() => go(at + 1)}>Skip</button>
        <button type="button" className="pill-btn" disabled={!current} onClick={() => current && onOpen(current)}>Open task</button>
        <button type="button" className="pill-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
