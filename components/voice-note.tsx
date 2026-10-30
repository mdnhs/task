"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Mic, Pause, Play, Square } from "lucide-react"

import { VOICE_MAX_SEC, atVoiceLimit, clampVoiceSec, formatClock, pickVoiceMime, voiceTotal } from "@/lib/task-voice"

// Voice instructions (lib/task-voice.ts): a recorder for forms and a player for real audio. Same visual language as the WhatsApp
// voice note (round brand play button, quiet track), own classes (.vn-* in app/styles/kit.css) so WhatsApp stays untouched.

/** What the recorder hands the form: a `blob:` URL owned by this tab, its length and container type. */
export type VoiceDraft = { url: string; durationSec: number; mime: string }

const noop = () => () => {}
const canRecord = () =>
  typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function"

type RecState = "idle" | "asking" | "recording" | "blocked" | "nomic" | "failed"

const MSG: Partial<Record<RecState, string>> = {
  blocked: "Microphone access was blocked. Allow it in the browser to record.",
  nomic: "No microphone was found on this device.",
  failed: "The recording could not be started. Try again.",
}

/**
 * Mic button → recording with a live timer and Stop → preview player with "Record again" and "Remove". Stops by itself at
 * VOICE_MAX_SEC. Without MediaRecorder or with the mic blocked it shows a short hint; the rest of the form keeps working.
 * The mic tracks stop on Stop and on unmount. The form owns the URL once handed over; the recorder only revokes URLs it
 * replaces or removes.
 */
export function VoiceRecorder({ id, value, onChange, max = VOICE_MAX_SEC }: { id: string; value: VoiceDraft | null; onChange(v: VoiceDraft | null): void; max?: number }) {
  const supported = useSyncExternalStore(noop, canRecord, () => true)
  const [state, setState] = useState<RecState>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [capped, setCapped] = useState(false)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; timer: number; started: number } | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  const release = () => {
    const r = rec.current
    if (!r) return
    window.clearInterval(r.timer)
    r.stream.getTracks().forEach((t) => t.stop())
    rec.current = null
  }

  // Unmount: stop the mic (and drop an unfinished recording).
  useEffect(
    () => () => {
      const r = rec.current
      if (r) {
        r.mr.ondataavailable = null
        r.mr.onstop = null
        if (r.mr.state !== "inactive") r.mr.stop()
      }
      release()
    },
    [],
  )

  const stop = (byLimit = false) => {
    const r = rec.current
    if (!r || r.mr.state === "inactive") return
    setCapped(byLimit)
    r.mr.stop()
  }

  async function start() {
    if (state === "asking" || state === "recording") return
    setState("asking")
    setCapped(false)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = (e as { name?: string })?.name
      setState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : name === "NotFoundError" || name === "OverconstrainedError" ? "nomic" : "failed")
      return
    }
    let mr: MediaRecorder
    try {
      const mime = pickVoiceMime((m) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(m))
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      setState("failed")
      return
    }
    const chunks: Blob[] = []
    mr.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data)
    }
    mr.onstop = () => {
      const r = rec.current
      const sec = clampVoiceSec(r ? (performance.now() - r.started) / 1000 : 0, max)
      release()
      setState("idle")
      if (!chunks.length || sec < 0.3) return
      const type = mr.mimeType || chunks[0].type || "audio/webm"
      const url = URL.createObjectURL(new Blob(chunks, { type }))
      onChangeRef.current({ url, durationSec: Math.round(sec * 10) / 10, mime: type })
    }
    const started = performance.now()
    const timer = window.setInterval(() => {
      const sec = (performance.now() - started) / 1000
      setElapsed(clampVoiceSec(sec, max))
      if (atVoiceLimit(sec, max)) stop(true)
    }, 200)
    rec.current = { mr, stream, timer, started }
    setElapsed(0)
    mr.start(250)
    setState("recording")
  }

  const remove = () => {
    if (value) URL.revokeObjectURL(value.url)
    onChange(null)
    setCapped(false)
  }
  const again = () => {
    remove()
    void start()
  }

  if (!supported)
    return (
      <p className="vn-hint" id={`${id}-hint`} role="status">
        Voice recording isn&apos;t available in this browser.
      </p>
    )

  if (state === "recording")
    return (
      <div className="vn-rec" role="group" aria-label="Recording voice instructions">
        <span className="vn-dot" aria-hidden="true" />
        <span className="vn-rec-t">Recording</span>
        <span className="vn-time num" aria-live="off">
          {formatClock(elapsed)} / {formatClock(max)}
        </span>
        <span className="vn-meter" aria-hidden="true"><i style={{ transform: `scaleX(${elapsed / max})` }} /></span>
        <button type="button" className="vn-stop" onClick={() => stop()} aria-label="Stop recording">
          <Square aria-hidden="true" />
          <span>Stop</span>
        </button>
      </div>
    )

  if (value)
    return (
      <div className="vn-preview">
        <VoiceNotePlayer url={value.url} durationSec={value.durationSec} label="voice instructions" />
        <div className="vn-row">
          {capped && <span className="vn-cap" role="status">Maximum 2 minutes</span>}
          <button type="button" className="vn-link" onClick={again}>Record again</button>
          <button type="button" className="vn-link bad" onClick={remove}>Remove</button>
        </div>
      </div>
    )

  return (
    <div className="vn-idle">
      <button type="button" id={id} className="vn-mic" onClick={() => void start()} disabled={state === "asking"} aria-describedby={MSG[state] ? `${id}-hint` : undefined}>
        <Mic aria-hidden="true" />
        <span>{state === "asking" ? "Waiting for the microphone…" : "Record"}</span>
      </button>
      {MSG[state] && (
        <p className="vn-hint" id={`${id}-hint`} role="status">
          {MSG[state]}
        </p>
      )}
    </div>
  )
}

/**
 * Plays a recording from a URL: play/pause, a scrubbable progress bar, elapsed / total. `durationSec` is the recorded length,
 * shown before the media loads and used when the browser reports no duration (recorded webm). `rate` sets the playback speed.
 */
export function VoiceNotePlayer({ url, durationSec, rate = 1, label = "voice note" }: { url: string; durationSec: number; rate?: number; label?: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [media, setMedia] = useState(Number.NaN)
  const total = voiceTotal(media, durationSec)

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate
  }, [rate])

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) {
      a.playbackRate = rate
      a.play().catch(() => setPlaying(false))
    } else a.pause()
  }
  const seek = (to: number) => {
    const a = audio.current
    setPos(to)
    if (a) a.currentTime = to
  }

  const played = total > 0 ? Math.min(1, pos / total) : 0
  return (
    <div className="vn-player">
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPos(0)
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setMedia(e.currentTarget.duration)}
        onDurationChange={(e) => setMedia(e.currentTarget.duration)}
      />
      <button type="button" className="vn-play" aria-label={playing ? `Pause ${label}` : `Play ${label}`} aria-pressed={playing} onClick={toggle}>
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <div className="vn-track">
        <span className="vn-bar" aria-hidden="true"><i style={{ transform: `scaleX(${played})` }} /></span>
        <input
          type="range"
          className="vn-seek"
          min={0}
          max={total || 0}
          step={0.1}
          value={Math.min(pos, total || 0)}
          aria-label={`Seek ${label}`}
          aria-valuetext={`${formatClock(pos)} of ${formatClock(total)}`}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>
      <span className="vn-dur num">
        {formatClock(pos)} / {formatClock(total)}
      </span>
    </div>
  )
}
