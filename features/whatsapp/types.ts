// WhatsApp notifications (FE-only MOCK until the backend exists). Outbound only: OpsDesk sends a message to a person's own WhatsApp for the events in their scope.
// These shapes are what the later API should return; the mock JSON in public/data/whatsapp/*.json matches them one to one.

/** Not connected -> Connecting -> Active. */
export type WaConnectionStatus = "not_connected" | "connecting" | "active"

export type WaConnection = {
  status: WaConnectionStatus
  /** The verified business number notifications are sent from (a business number, not a person's). */
  number: string
  businessName: string
  lastEvent: string
  lastEventAt: string | null
  /** Messages today, shown on the Active card. */
  today: { sent: number; delivered: number; failed: number }
}

/** How the owner sends one kind: email only, WhatsApp only, both always on (no dedupe), or WhatsApp first with email when it is not delivered. */
export type WaVia = "email" | "whatsapp" | "both" | "whatsapp_then_email"
/** One notification kind the product has. `scope` says who gets it. `via` is the owner's choice (`default` = the tenant-wide default). `locked` = fixed (security). */
export type WaKind = { id: string; label: string; hint: string; scope: string; via: WaVia | "default"; locked: boolean }

/** The plan's WhatsApp allowance. `limit` null = unlimited. */
export type WaPlan = { name: string; whatsapp: boolean; limit: number | null; used: number }

export type WaPersonStatus = "no_number" | "pending" | "verified" | "opted_out"
export type WaScopeKind = "own" | "team" | "department" | "all"
export type WaPerson = {
  id: string
  name: string
  email: string
  role: string
  scope: { kind: WaScopeKind; label: string }
  status: WaPersonStatus
  /** Only the last 3 digits ever reach the screen. */
  phoneLast3: string | null
  lastMessageAt: string | null
}

export type WaMessageStatus = "queued" | "sent" | "delivered" | "read" | "failed"
/** One row of the message log. Never a message body: only who, which template and what happened. */
export type WaMessage = { id: string; at: string; recipient: string; phoneLast3: string; template: string; status: WaMessageStatus; reason: string | null }

export type WaTemplateStatus = "approved" | "pending" | "rejected"
export type WaTemplate = { id: string; name: string; kind: string; language: string; status: WaTemplateStatus; reason: string | null }

export type WaCountry = { code: string; name: string; dial: string }

/** The signed-in person's own WhatsApp setup (Account -> Notifications). */
export type WaSelfPhase = "none" | "verified" | "opted_out"
export type WaChannelPrefs = { inApp: boolean; email: boolean; whatsapp: boolean }
export type WaSelf = { phase: WaSelfPhase; country: string; national: string | null; channels: Record<string, WaChannelPrefs> }

/** Everything the screens need; the store holds it and the interactions change it locally. */
export type WaState = {
  connection: WaConnection
  /** The tenant-wide default for kinds set to `default`. */
  defaultVia: WaVia
  kinds: WaKind[]
  plan: WaPlan
  people: WaPerson[]
  messages: WaMessage[]
  templates: WaTemplate[]
  countries: WaCountry[]
  self: WaSelf
}
