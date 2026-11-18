// Pure rules of the WhatsApp UI: the connection steps, phone entry and masking, consent gating, the resend timer, the people filters. No React, no I/O.
import type { WaConnection, WaConnectionStatus, WaKind, WaMessage, WaMessageStatus, WaPerson, WaPersonStatus, WaTemplateStatus } from "./types"

export const CODE_LENGTH = 6
export const RESEND_SECONDS = 30
/** How long the mock "Connecting" step lasts. */
export const CONNECT_MS = 1800
export const PEOPLE_PAGE_SIZE = 8
export const LOG_PAGE_SIZE = 8

// ---- connection steps: Not connected -> Connecting -> Active (and off again) ----
export type WaConnectionEvent = "start" | "ready" | "off"

/** One step of the state machine. A step that does not apply to the current status leaves the connection as it is. */
export function nextConnection(c: WaConnection, ev: WaConnectionEvent, at: string): WaConnection {
  if (ev === "start" && c.status === "not_connected") return { ...c, status: "connecting", lastEvent: "Connecting", lastEventAt: at }
  if (ev === "ready" && c.status === "connecting") return { ...c, status: "active", lastEvent: "Connected", lastEventAt: at }
  if (ev === "off" && c.status !== "not_connected") return { ...c, status: "not_connected", lastEvent: "Turned off", lastEventAt: at }
  return c
}

/** The panel header counter on Settings -> Integrations: the API's integrations plus WhatsApp. */
export const connectedCount = (base: number, status: WaConnectionStatus): number => base + (status === "active" ? 1 : 0)

// ---- phone entry ----
export const digitsOnly = (s: string): string => s.replace(/\D/g, "")
/** The national part as digits: spaces, dashes and one leading 0 (the trunk prefix) removed. */
export const nationalDigits = (s: string): string => digitsOnly(s).replace(/^0/, "")
export const validNational = (digits: string): boolean => digits.length >= 7 && digits.length <= 12
/** "+353 ••• ••• 567": only the last 3 digits are shown, and the number of bullets never reveals the length. */
export const maskPhone = (dial: string, national: string): string => `+${dial} ••• ••• ${national.slice(-3)}`
/** For lists and the log, where only the last 3 digits are known. */
export const maskLast3 = (last3: string | null): string => (last3 ? `••• ${last3}` : "No number")

/** "Send code" is enabled only for a valid number AND the ticked consent. */
export const canSendCode = (i: { national: string; consent: boolean }): boolean => i.consent && validNational(nationalDigits(i.national))
export const cleanCode = (s: string): string => digitsOnly(s).slice(0, CODE_LENGTH)
export const canVerify = (code: string): boolean => cleanCode(code).length === CODE_LENGTH

/** One second of the resend timer (never below 0). */
export const tickResend = (left: number): number => Math.max(0, left - 1)
export const countdown = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

// ---- what a person can choose ----
/** The kinds the admin has turned on, when WhatsApp itself is on. Nothing otherwise. */
export const enabledKinds = (kinds: WaKind[], status: WaConnectionStatus): WaKind[] => (status === "active" ? kinds.filter((k) => k.enabled) : [])

// ---- people list ----
export type WaPeopleTab = "all" | WaPersonStatus
export const PEOPLE_TABS: { value: WaPeopleTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "no_number", label: "No number" },
  { value: "opted_out", label: "Opted out" },
]
export const PERSON_STATUS: Record<WaPersonStatus, { tone: "ok" | "warn" | "mute" | "bad"; label: string }> = {
  verified: { tone: "ok", label: "Verified" },
  pending: { tone: "warn", label: "Pending verification" },
  no_number: { tone: "mute", label: "No number" },
  opted_out: { tone: "bad", label: "Opted out" },
}
export function filterPeople(people: WaPerson[], tab: WaPeopleTab, q: string): WaPerson[] {
  const n = q.trim().toLowerCase()
  return people.filter((p) => (tab === "all" || p.status === tab) && (!n || p.name.toLowerCase().includes(n) || p.role.toLowerCase().includes(n) || p.scope.label.toLowerCase().includes(n)))
}
export const peopleCounts = (people: WaPerson[]): Record<WaPeopleTab, number> => ({
  all: people.length,
  verified: people.filter((p) => p.status === "verified").length,
  pending: people.filter((p) => p.status === "pending").length,
  no_number: people.filter((p) => p.status === "no_number").length,
  opted_out: people.filter((p) => p.status === "opted_out").length,
})

// ---- message log ----
export const MESSAGE_STATUS: Record<WaMessageStatus, { tone: "ok" | "info" | "mute" | "bad"; label: string }> = {
  queued: { tone: "mute", label: "Queued" },
  sent: { tone: "info", label: "Sent" },
  delivered: { tone: "ok", label: "Delivered" },
  read: { tone: "ok", label: "Read" },
  failed: { tone: "bad", label: "Failed" },
}
export const LOG_TABS: { value: "all" | WaMessageStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "failed", label: "Failed" },
]
export function filterMessages(messages: WaMessage[], tab: "all" | WaMessageStatus, q: string): WaMessage[] {
  const n = q.trim().toLowerCase()
  return messages.filter((m) => (tab === "all" || m.status === tab) && (!n || m.recipient.toLowerCase().includes(n) || m.template.toLowerCase().includes(n)))
}

export const TEMPLATE_STATUS: Record<WaTemplateStatus, { tone: "ok" | "warn" | "bad"; label: string }> = {
  approved: { tone: "ok", label: "Approved" },
  pending: { tone: "warn", label: "Pending" },
  rejected: { tone: "bad", label: "Rejected" },
}
