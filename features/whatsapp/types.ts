import type { Person, Status } from "@/lib/types"

// WhatsApp inbox (SRS §3.17, FR-WA-01..08, OC-05). Everything here is mock data until the client confirms the provider.

export type FlowId = "alerts" | "inbound" | "outbound" | "task_creation" | "voice"
export type FlowState = "enabled" | "pending"
export type IntegrationStatus = "pending" | "connected" | "disconnected"

export type Integration = {
  /** Proposed or chosen provider, e.g. a WhatsApp Business API partner. Null until the client picks one (FR-WA-01). */
  provider: string | null
  method: string
  /** Business number in display form; null until confirmed. */
  businessNumber: string | null
  status: IntegrationStatus
  /** Short line under the status, from the tenant's setup record. */
  note: string
  lastSyncAt?: string
  /** Set when status is disconnected (FR-WA-07). */
  error?: { title: string; detail: string; since: string }
  flows: { id: FlowId; label: string; description: string; state: FlowState }[]
  /** FR-WA-06: the approved privacy, consent, storage and deletion rules. */
  privacy: { audioRetentionDays: number; transcriptRetentionDays: number; storage: string; transcription: string; consent: string }
}

export type LinkKind = "user" | "task" | "issue" | "report"
export type LinkRef = { kind: LinkKind; ref: string; label: string; href?: string }
export type LinkTargets = Record<LinkKind, LinkRef[]>

export type Delivery = "sent" | "delivered" | "read" | "failed"

export type TranscriptState = "transcribing" | "ready" | "failed" | "unsupported"
export type Transcript = {
  state: TranscriptState
  text?: string
  /** 0..1 from the transcription service. Below LOW_CONFIDENCE the bubble warns about poor quality. */
  confidence?: number
  /** Set once a user confirms (FR-WA-05). Until then the text is machine-generated. */
  confirmedBy?: string
  confirmedAt?: string
  edited?: boolean
  error?: string
  /** Mock only: what the service returns when a transcribing note finishes or a failed one is retried. */
  result?: { text: string; confidence: number }
}

type Base = { id: string; at: string }
export type TextMessage = Base & { kind: "text"; dir: "in" | "out"; text: string; by?: string; delivery?: Delivery; links?: LinkRef[] }
export type VoiceMessage = Base & {
  kind: "voice"
  dir: "in" | "out"
  durationSec: number
  /** Audio container, e.g. "ogg". */
  format: string
  supported: boolean
  transcript: Transcript
  by?: string
  delivery?: Delivery
  links?: LinkRef[]
}
/** Auditable record of a send / link / task create / transcript confirm (FR-WA-04). */
export type EventMessage = Base & { kind: "event"; by: string; text: string }
export type Message = TextMessage | VoiceMessage | EventMessage

export type Contact = {
  name: string
  phone: string
  initials: string
  avatar: Person["avatar"]
  /** Staff role or client site, shown under the name. */
  role: string
  dept: string
  /** Directory person this contact is (link kind "user"), when known. */
  userRef?: string
  consent: "given" | "pending"
}

export type Conversation = { id: string; contact: Contact; unread: number; messages: Message[] }

export type InboxFilter = "all" | "unread" | "linked" | "unlinked" | "voice"

export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "linked", label: "Linked" },
  { value: "unlinked", label: "Unlinked" },
  { value: "voice", label: "Voice" },
]

export const LINK_KIND: Record<LinkKind, string> = { user: "User", task: "Task", issue: "Client issue", report: "Report item" }
export const LINK_KIND_ORDER = Object.keys(LINK_KIND) as LinkKind[]

export const INTEGRATION_STATUS: Record<IntegrationStatus, Status> = {
  pending: { tone: "warn", label: "Awaiting client confirmation" },
  connected: { tone: "ok", label: "Connected" },
  disconnected: { tone: "bad", label: "Disconnected" },
}
export const FLOW_STATE: Record<FlowState, Status> = {
  enabled: { tone: "ok", label: "Enabled" },
  pending: { tone: "mute", label: "Pending" },
}

/** Transcripts below this confidence get the poor-quality warning (FR-WA-07). */
export const LOW_CONFIDENCE = 0.7
