// Maps the (mock, later real) API payloads to the screen types. It throws on a shape it does not know, so a wrong response is an error state, never a half-drawn page.
import type { WaConnection, WaCountry, WaKind, WaMessage, WaPerson, WaPlan, WaSelf, WaState, WaTemplate, WaVia } from "./types"

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`whatsapp: ${k} must be ${want}`)
}
const rec = (v: unknown, k: string): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : bad(k, "an object"))
const arr = (v: unknown, k: string): unknown[] => (Array.isArray(v) ? v : bad(k, "a list"))
const str = (v: unknown, k: string): string => (typeof v === "string" ? v : bad(k, "text"))
const strOrNull = (v: unknown, k: string): string | null => (v === null ? null : str(v, k))
const bool = (v: unknown, k: string): boolean => (typeof v === "boolean" ? v : bad(k, "true or false"))
const num = (v: unknown, k: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(k, "a number"))
const oneOf = <T extends string>(v: unknown, k: string, allowed: readonly T[]): T => (allowed.includes(v as T) ? (v as T) : bad(k, `one of ${allowed.join(", ")}`))

export function toConnection(dto: unknown): WaConnection {
  const r = rec(dto, "connection")
  const t = rec(r.today, "connection.today")
  return {
    status: oneOf(r.status, "connection.status", ["not_connected", "connecting", "active"]),
    number: str(r.number, "connection.number"),
    businessName: str(r.businessName, "connection.businessName"),
    lastEvent: str(r.lastEvent, "connection.lastEvent"),
    lastEventAt: strOrNull(r.lastEventAt, "connection.lastEventAt"),
    today: { sent: num(t.sent, "today.sent"), delivered: num(t.delivered, "today.delivered"), failed: num(t.failed, "today.failed") },
  }
}

const VIAS = ["email", "whatsapp", "both", "whatsapp_then_email"] as const
export const toDefaultVia = (dto: unknown): WaVia => oneOf(rec(dto, "kinds").defaultVia, "defaultVia", VIAS)
export const toKinds = (dto: unknown): WaKind[] =>
  arr(rec(dto, "kinds").kinds, "kinds").map((x, i) => {
    const r = rec(x, `kinds[${i}]`)
    return {
      id: str(r.id, "kind.id"), label: str(r.label, "kind.label"), hint: str(r.hint, "kind.hint"), scope: str(r.scope, "kind.scope"),
      via: oneOf(r.via, "kind.via", [...VIAS, "default"] as const), locked: bool(r.locked, "kind.locked"),
    }
  })

export function toPlan(dto: unknown): WaPlan {
  const r = rec(dto, "plan")
  return { name: str(r.name, "plan.name"), whatsapp: bool(r.whatsapp, "plan.whatsapp"), limit: r.limit === null ? null : num(r.limit, "plan.limit"), used: num(r.used, "plan.used") }
}

export const toPeople = (dto: unknown): WaPerson[] =>
  arr(rec(dto, "people").people, "people").map((x, i) => {
    const r = rec(x, `people[${i}]`)
    const s = rec(r.scope, "person.scope")
    return {
      id: str(r.id, "person.id"), name: str(r.name, "person.name"), email: str(r.email, "person.email"), role: str(r.role, "person.role"),
      scope: { kind: oneOf(s.kind, "scope.kind", ["own", "team", "department", "all"]), label: str(s.label, "scope.label") },
      status: oneOf(r.status, "person.status", ["no_number", "pending", "verified", "opted_out"]),
      // Never more than 3 digits, whatever the payload carries.
      phoneLast3: r.phoneLast3 === null ? null : str(r.phoneLast3, "person.phoneLast3").slice(-3),
      lastMessageAt: strOrNull(r.lastMessageAt, "person.lastMessageAt"),
    }
  })

export const toMessages = (dto: unknown): WaMessage[] =>
  arr(rec(dto, "messages").messages, "messages").map((x, i) => {
    const r = rec(x, `messages[${i}]`)
    return {
      id: str(r.id, "message.id"), at: str(r.at, "message.at"), recipient: str(r.recipient, "message.recipient"), phoneLast3: str(r.phoneLast3, "message.phoneLast3").slice(-3),
      template: str(r.template, "message.template"), status: oneOf(r.status, "message.status", ["queued", "sent", "delivered", "read", "failed"]), reason: strOrNull(r.reason, "message.reason"),
    }
  })

export const toTemplates = (dto: unknown): WaTemplate[] =>
  arr(rec(dto, "templates").templates, "templates").map((x, i) => {
    const r = rec(x, `templates[${i}]`)
    return {
      id: str(r.id, "template.id"), name: str(r.name, "template.name"), kind: str(r.kind, "template.kind"), language: str(r.language, "template.language"),
      status: oneOf(r.status, "template.status", ["approved", "pending", "rejected"]), reason: strOrNull(r.reason, "template.reason"),
    }
  })

export const toCountries = (dto: unknown): WaCountry[] =>
  arr(rec(dto, "countries").countries, "countries").map((x, i) => {
    const r = rec(x, `countries[${i}]`)
    return { code: str(r.code, "country.code"), name: str(r.name, "country.name"), dial: str(r.dial, "country.dial") }
  })

export function toSelf(dto: unknown): WaSelf {
  const r = rec(dto, "self")
  const channels: WaSelf["channels"] = {}
  for (const [k, v] of Object.entries(rec(r.channels, "self.channels"))) {
    const c = rec(v, `channels.${k}`)
    channels[k] = { inApp: bool(c.inApp, "inApp"), email: bool(c.email, "email"), whatsapp: bool(c.whatsapp, "whatsapp") }
  }
  return { phase: oneOf(r.phase, "self.phase", ["none", "verified", "opted_out"]), country: str(r.country, "self.country"), national: strOrNull(r.national, "self.national"), channels }
}

export type WaRaw = { connection: unknown; kinds: unknown; plan: unknown; people: unknown; messages: unknown; templates: unknown; countries: unknown; self: unknown }
export const toState = (raw: WaRaw): WaState => ({
  connection: toConnection(raw.connection), defaultVia: toDefaultVia(raw.kinds), kinds: toKinds(raw.kinds), plan: toPlan(raw.plan), people: toPeople(raw.people), messages: toMessages(raw.messages),
  templates: toTemplates(raw.templates), countries: toCountries(raw.countries), self: toSelf(raw.self),
})
