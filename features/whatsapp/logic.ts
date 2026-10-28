import { daysBetween, formatDate } from "@/lib/dates"
import type { Conversation, Delivery, FlowId, InboxFilter, Integration, LinkRef, Message, VoiceMessage } from "./types"

// Pure inbox logic: store actions, gates and filters. Components call these through whatsappStore; tests call them directly.

export type Gate = { ok: true } | { ok: false; reason: string }
export type Gates = { send: Gate; link: Gate; task: Gate; confirm: Gate; transcribe: Gate }

const OK: Gate = { ok: true }
const no = (reason: string): Gate => ({ ok: false, reason })

export function flowOn(integration: Integration, id: FlowId): boolean {
  return integration.flows.some((f) => f.id === id && f.state === "enabled")
}

/**
 * FR-WA-04: sending and task creation need configured permissions; flows the client hasn't confirmed stay off (OC-05);
 * a disconnected integration can't send (FR-WA-07). Read-only roles keep the inbox but no action.
 */
export function gates({ canWrite, canCreateTasks, integration }: { canWrite: boolean; canCreateTasks: boolean; integration: Integration }): Gates {
  const readOnly = no("You have read-only access to WhatsApp. Ask a manager to reply, link or create tasks.")
  const transcribe = flowOn(integration, "voice") ? OK : no("Voice transcription isn't enabled yet: waiting for client confirmation.")
  if (!canWrite) return { send: readOnly, link: readOnly, task: readOnly, confirm: readOnly, transcribe }
  const send =
    integration.status === "disconnected"
      ? no("WhatsApp is disconnected. Replies can't be sent until the integration is reconnected.")
      : !flowOn(integration, "outbound")
        ? no("Outbound replies aren't enabled yet: waiting for client confirmation.")
        : OK
  const task = !flowOn(integration, "task_creation")
    ? no("Task creation from WhatsApp isn't enabled yet: waiting for client confirmation.")
    : !canCreateTasks
      ? no("Creating tasks needs write access to Tasks.")
      : OK
  return { send, link: OK, task, confirm: transcribe, transcribe }
}

const update = (list: Conversation[], id: string, fn: (c: Conversation) => Conversation) => list.map((c) => (c.id === id ? fn(c) : c))
const nextId = (c: Conversation) => `${c.id}-m${c.messages.length + 1}`
const event = (c: Conversation, at: string, by: string, text: string): Message => ({ id: nextId(c), kind: "event", at, by, text })

export function sendMessage(list: Conversation[], convId: string, text: string, by: string, at: string): Conversation[] {
  const body = text.trim()
  if (!body) return list
  return update(list, convId, (c) => ({ ...c, messages: [...c.messages, { id: nextId(c), kind: "text", dir: "out", text: body, by, at, delivery: "sent" }] }))
}

export function setDelivery(list: Conversation[], convId: string, msgId: string, delivery: Delivery): Conversation[] {
  return update(list, convId, (c) => ({
    ...c,
    messages: c.messages.map((m) => (m.id === msgId && m.kind !== "event" && m.dir === "out" ? { ...m, delivery } : m)),
  }))
}

const withLink = (m: Message, link: LinkRef): Message =>
  m.kind === "event" || m.links?.some((l) => l.kind === link.kind && l.ref === link.ref) ? m : { ...m, links: [...(m.links ?? []), link] }

/** Links a message to a record and appends the audit event. Linking the same record twice is a no-op. */
export function linkMessage(list: Conversation[], convId: string, msgId: string, link: LinkRef, by: string, at: string): Conversation[] {
  return update(list, convId, (c) => {
    const m = c.messages.find((x) => x.id === msgId)
    if (!m || m.kind === "event" || m.links?.some((l) => l.kind === link.kind && l.ref === link.ref)) return c
    return { ...c, messages: [...c.messages.map((x) => (x.id === msgId ? withLink(x, link) : x)), event(c, at, by, `Linked to ${link.ref} by ${by}`)] }
  })
}

export function createTaskFromMessage(list: Conversation[], convId: string, msgId: string, task: { ref: string; title: string }, by: string, at: string): Conversation[] {
  const link: LinkRef = { kind: "task", ref: task.ref, label: task.title }
  return update(list, convId, (c) => {
    if (!c.messages.some((x) => x.id === msgId && x.kind !== "event")) return c
    return { ...c, messages: [...c.messages.map((x) => (x.id === msgId ? withLink(x, link) : x)), event(c, at, by, `Task ${task.ref} created from this message by ${by}`)] }
  })
}

const voice = (c: Conversation, msgId: string) => c.messages.find((m): m is VoiceMessage => m.id === msgId && m.kind === "voice")

/** FR-WA-05: the transcript stops being machine-generated once a user confirms it, with or without edits. */
export function confirmTranscript(list: Conversation[], convId: string, msgId: string, text: string, by: string, at: string): Conversation[] {
  return update(list, convId, (c) => {
    const m = voice(c, msgId)
    if (!m || m.transcript.state !== "ready" || m.transcript.confirmedBy) return c
    const body = text.trim() || m.transcript.text || ""
    const edited = body !== (m.transcript.text ?? "")
    const next: VoiceMessage = { ...m, transcript: { ...m.transcript, text: body, edited, confirmedBy: by, confirmedAt: at } }
    return {
      ...c,
      messages: [...c.messages.map((x) => (x.id === msgId ? next : x)), event(c, at, by, `Transcript ${edited ? "edited and confirmed" : "confirmed"} by ${by}`)],
    }
  })
}

/** Retry a failed transcript (or start one): back to transcribing. */
export function retryTranscript(list: Conversation[], convId: string, msgId: string): Conversation[] {
  return update(list, convId, (c) => ({
    ...c,
    messages: c.messages.map((m) => (m.id === msgId && m.kind === "voice" && m.supported ? { ...m, transcript: { ...m.transcript, state: "transcribing", error: undefined } } : m)),
  }))
}

/** Mock service reply: a transcribing note becomes ready with its stored result, or fails when there is none. */
export function finishTranscript(list: Conversation[], convId: string, msgId: string): Conversation[] {
  return update(list, convId, (c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (m.id !== msgId || m.kind !== "voice" || m.transcript.state !== "transcribing") return m
      const r = m.transcript.result
      return {
        ...m,
        transcript: r
          ? { ...m.transcript, state: "ready", text: r.text, confidence: r.confidence, result: undefined }
          : { ...m.transcript, state: "failed", error: "The transcription service didn't return a result." },
      }
    }),
  }))
}

export function markRead(list: Conversation[], convId: string): Conversation[] {
  return list.some((c) => c.id === convId && c.unread > 0) ? update(list, convId, (c) => ({ ...c, unread: 0 })) : list
}

/** Unique records linked from any message, in link order. */
export function linkedRecords(c: Conversation): LinkRef[] {
  const out: LinkRef[] = []
  for (const m of c.messages) if (m.kind !== "event") for (const l of m.links ?? []) if (!out.some((o) => o.kind === l.kind && o.ref === l.ref)) out.push(l)
  return out
}

export const lastMessage = (c: Conversation) => c.messages.findLast((m) => m.kind !== "event") ?? c.messages.at(-1)

export function preview(m: Message | undefined): string {
  if (!m) return ""
  if (m.kind === "voice") return m.transcript.state === "ready" && m.transcript.text ? `Voice note: ${m.transcript.text}` : "Voice note"
  return m.text
}

export function filterConversations(list: Conversation[], { q, filter, dept }: { q: string; filter: InboxFilter; dept: string }): Conversation[] {
  const s = q.trim().toLowerCase()
  return list
    .filter((c) => dept === "all" || c.contact.dept === dept)
    .filter((c) => {
      if (filter === "unread") return c.unread > 0
      if (filter === "linked") return linkedRecords(c).length > 0
      if (filter === "unlinked") return linkedRecords(c).length === 0
      if (filter === "voice") return c.messages.some((m) => m.kind === "voice")
      return true
    })
    .filter(
      (c) =>
        !s ||
        [c.contact.name, c.contact.phone, c.contact.role].some((v) => v.toLowerCase().includes(s)) ||
        c.messages.some((m) => (m.kind === "voice" ? m.transcript.text ?? "" : m.text).toLowerCase().includes(s)),
    )
    .sort((a, b) => (lastMessage(b)?.at ?? "").localeCompare(lastMessage(a)?.at ?? ""))
}

/** Next free TSK-… number above every task ref we know (targets + tasks created here). */
export function nextTaskRef(known: string[]): string {
  const max = known.reduce((m, r) => Math.max(m, parseInt(r.replace(/\D/g, ""), 10) || 0), 1000)
  return `TSK-${max + 1}`
}

/** Text a "create task" dialog starts from: the message text or the voice transcript. */
export function messageText(m: Message): string {
  if (m.kind === "voice") return m.transcript.text ?? ""
  return m.text
}

/** Deterministic waveform bars (0.2..1) for a voice note, so server and client render the same. */
export function waveform(id: string, bars = 32): number[] {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 16777619)
    const v = ((h >>> 0) % 1000) / 1000
    // Rounded so the inline style string is identical on server and client (no hydration mismatch).
    return Math.round((0.2 + 0.8 * Math.abs(Math.sin((i / bars) * Math.PI)) * (0.45 + 0.55 * v)) * 1000) / 1000
  })
}

/** Day separator text in a thread: Today / Yesterday / "Mon 19 Oct", against the org's today. */
export function dayLabel(iso: string, today: string): string {
  const d = daysBetween(iso, today)
  return d === 0 ? "Today" : d === -1 ? "Yesterday" : formatDate(iso)
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
