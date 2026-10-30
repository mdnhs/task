import type { TodayTask } from "./today"

// Spoken task instructions (product owner change request, 30 Oct 2026; not in the BA's SRS). Recorded on the New task page,
// played on the task and in "Play my day". No transcription or AI here: speech-to-text stays in Module 2 (FR-M2-07).
// Pure helpers plus a module-level hand-off like lib/task-inbox.ts (written on the client only; survives client navigation,
// resets on reload).

/**
 * The recording on a task. In this front-end mock `url` is a `blob:` object URL that lives only in this browser tab, so it is
 * gone on reload like every mock edit. With the backend it becomes a stored file (tenant storage, signed URL) with a retention
 * rule; see .claude/docs/features/tasks.md → Voice instructions.
 */
export type VoiceNote = {
  url: string
  durationSec: number
  mime: string
  /** Display name of who recorded it. */
  recordedBy: string
  /** YYYY-MM-DDTHH:mm:ss, tenant time. */
  recordedAt: string
}

/** Hard limit: the recorder stops by itself here. */
export const VOICE_MAX_SEC = 120
/** Said by "Play my day" right before it plays the recording. */
export const VOICE_LEAD = "Voice instructions:"

/** Seconds as m:ss (0:07, 1:42, 2:00). Negative, NaN and Infinity read as 0:00. */
export function formatClock(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Elapsed recording time in whole-ish seconds, never past the limit. */
export const clampVoiceSec = (sec: number, max = VOICE_MAX_SEC) => (Number.isFinite(sec) && sec > 0 ? Math.min(sec, max) : 0)

/** True once the recording has reached the limit (the recorder then stops and says so). */
export const atVoiceLimit = (sec: number, max = VOICE_MAX_SEC) => Number.isFinite(sec) && sec >= max

/** Container types in preference order; the first the browser can record wins ("" = let the browser choose). */
export const VOICE_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const
export function pickVoiceMime(canRecord: (mime: string) => boolean): string {
  return VOICE_MIMES.find((m) => canRecord(m)) ?? ""
}

/** Total length to show: the media's own duration when the browser knows it (recorded webm often reports Infinity), else the recorded length. */
export const voiceTotal = (mediaDuration: number, recorded: number) => (Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : recorded)

// ---------- hand-off to the Today card ----------

/**
 * A task with voice instructions created in this session, for the Today card (features can't import each other, and the Today
 * data is cut on the server from the seed, which has no recordings). `task` is the briefing line, `assignees` the Person ids
 * it belongs to, so the card only takes the signed-in person's own tasks.
 */
export type VoiceEntry = { tenantId: string; ref: string; assignees: string[]; task: TodayTask; note: VoiceNote }

const entries: VoiceEntry[] = []

export const taskVoice = {
  /** Adds or replaces the entry for that tenant and ref. */
  put(e: VoiceEntry) {
    const i = entries.findIndex((x) => x.tenantId === e.tenantId && x.ref === e.ref)
    if (i >= 0) entries[i] = e
    else entries.push(e)
  },
  /** Only the given tenant's entries. */
  list: (tenantId: string): VoiceEntry[] => entries.filter((e) => e.tenantId === tenantId),
  /** Tests only. */
  reset() {
    entries.length = 0
  },
}

/**
 * The Today card's task list with this session's voiced tasks: their notes by ref, and the person's own new tasks added when the
 * server list does not have them yet.
 */
export function withVoice(tasks: TodayTask[], voiced: readonly VoiceEntry[], meId: string): { tasks: TodayTask[]; notes: Record<string, VoiceNote> } {
  const have = new Set(tasks.map((t) => t.ref))
  const mine = voiced.filter((e) => e.assignees.includes(meId))
  const notes: Record<string, VoiceNote> = {}
  for (const e of mine) notes[e.ref] = e.note
  const extra = mine.filter((e) => !have.has(e.ref)).map((e) => e.task)
  return { tasks: extra.length ? [...tasks, ...extra] : tasks, notes }
}
