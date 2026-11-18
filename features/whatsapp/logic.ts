// Pure rules of the WhatsApp UI: the connection steps, phone entry and masking, consent gating, the resend timer, the people filters. No React, no I/O.
import { digitsOnly, nationalDigits, validE164 } from "@/lib/phone"
import type { PhoneValue } from "@/lib/phone"
import { WA_PERSON_STATUS, effectiveStatus } from "@/lib/wa-status"
import type { WaConnection, WaConnectionStatus, WaKind, WaMessage, WaMessageStatus, WaPerson, WaPersonStatus, WaPlan, WaTemplateStatus, WaVia } from "./types"

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
export { digitsOnly, e164, maskLast3, maskPhone, nationalDigits, validE164, validNational } from "@/lib/phone"

/** "Send code" is enabled only for a valid E.164 number AND the ticked consent. */
export const canSendCode = (i: { dial: string; national: string; consent: boolean }): boolean => i.consent && validE164(i.dial, i.national)
export const cleanCode = (s: string): string => digitsOnly(s).slice(0, CODE_LENGTH)
export const canVerify = (code: string): boolean => cleanCode(code).length === CODE_LENGTH

/** One second of the resend timer (never below 0). */
export const tickResend = (left: number): number => Math.max(0, left - 1)
export const countdown = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

// ---- what a person can choose ----
// ---- the owner's "Send via" choice ----
export const VIA_OPTIONS: { value: WaVia; label: string }[] = [
  { value: "email", label: "Email only" },
  { value: "whatsapp", label: "WhatsApp only" },
  { value: "both", label: "Email + WhatsApp" },
  { value: "whatsapp_then_email", label: "WhatsApp first, email if not delivered" },
]
export const viaLabel = (v: WaVia): string => VIA_OPTIONS.find((o) => o.value === v)?.label ?? v
/** A kind set to `default` follows the tenant-wide default. */
export const resolveVia = (k: Pick<WaKind, "via">, def: WaVia): WaVia => (k.via === "default" ? def : k.via)
export const viaHasWhatsApp = (v: WaVia): boolean => v !== "email"
export const viaHasEmail = (v: WaVia): boolean => v !== "whatsapp"
/** "Both" is always allowed: the owner decides, there is no forced dedupe. */
export const kindsOnWhatsApp = (kinds: WaKind[], def: WaVia): number => kinds.filter((k) => viaHasWhatsApp(resolveVia(k, def))).length

/** What a person can choose from: the kinds the owner sends on WhatsApp, only while WhatsApp is Active and the plan has it. Nothing otherwise. */
export const enabledKinds = (kinds: WaKind[], status: WaConnectionStatus, def: WaVia, plan: WaPlan): WaKind[] =>
  status === "active" && plan.whatsapp ? kinds.filter((k) => viaHasWhatsApp(resolveVia(k, def))) : []

// ---- plan allowance ----
export const usagePct = (p: WaPlan): number => (p.limit ? Math.min(100, Math.round((p.used / p.limit) * 100)) : 0)
export const usageNote = (p: WaPlan): string => (!p.whatsapp ? "WhatsApp is not in your plan." : p.limit === null ? `Plan: unlimited WhatsApp messages, ${p.used.toLocaleString("en-IE")} used` : `Plan: ${p.limit.toLocaleString("en-IE")} WhatsApp messages per month, ${p.used.toLocaleString("en-IE")} used`)

// ---- people list ----
export type WaPeopleTab = "all" | WaPersonStatus
export const PEOPLE_TABS: { value: WaPeopleTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "no_number", label: "No number" },
  { value: "opted_out", label: "Opted out" },
]
export const PERSON_STATUS = WA_PERSON_STATUS
/** The list as the owner sees it: a staged number makes a person Pending confirmation, a cleared one No number, and a staged number for someone not in the list (an invite) adds a row. */
export function withStaged(people: WaPerson[], staged: Record<string, PhoneValue | null>): WaPerson[] {
  const known = new Set(people.map((p) => p.email.toLowerCase()))
  const mapped = people.map((p) => {
    const s = staged[p.email.toLowerCase()]
    if (s === undefined) return p
    return { ...p, status: effectiveStatus(p.status, s), phoneLast3: s ? nationalDigits(s.national).slice(-3) : null, lastMessageAt: s ? p.lastMessageAt : null }
  })
  const invited: WaPerson[] = Object.entries(staged)
    .filter(([email, s]) => s && !known.has(email))
    .map(([email, s]) => ({ id: email, name: email, email, role: "Invited", scope: { kind: "own", label: "Own items" }, status: "pending", phoneLast3: nationalDigits(s!.national).slice(-3), lastMessageAt: null }))
  return [...mapped, ...invited]
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
