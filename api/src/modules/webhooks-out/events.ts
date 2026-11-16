import type { DomainEvent, EventType } from "../../core/events"

/**
 * The central allow-list of bus event types a tenant may subscribe an outgoing webhook to (T3.6), and for each type the ONLY
 * payload keys that leave the system. The envelope sent is `{ id, type, occurredAt, tenantId, data }` where `data` is this
 * ids-only projection: bus payloads carry data that must not be pushed to third parties (an invitee's email, a virus signature,
 * a data subject's id, money), so anything not listed here is dropped, and non-primitive values are never copied.
 *
 *   member.joined           userId, roleKey, inviteId          (no name or email)
 *   member.role_changed     userId, fromRoleKey, toRoleKey
 *   member.removed          userId
 *   invite.created          inviteId, roleKey                  (the invitee's email is dropped)
 *   team.created/updated    teamId, name, kind                 (an organisational label chosen by the tenant, not personal data)
 *   team.deleted            teamId
 *   file.uploaded           fileId, mime, sizeBytes            (no file name)
 *   file.scanned            fileId, status                     (the scanner's signature is dropped)
 *   file.deleted            fileId
 *   integration.connected   integrationId, provider            (no account e-mail, no tokens)
 *   integration.disconnected integrationId, provider
 *
 * Deliberately NOT subscribable: dsr.* (GDPR data-subject requests: personal data and legal handling), billing.* (financial,
 * platform-driven). Adding a type means adding its projection here, and nothing else.
 */
const PROJECTION = {
  "member.joined": ["userId", "roleKey", "inviteId"],
  "member.role_changed": ["userId", "fromRoleKey", "toRoleKey"],
  "member.removed": ["userId"],
  "invite.created": ["inviteId", "roleKey"],
  "team.created": ["teamId", "name", "kind"],
  "team.updated": ["teamId", "name", "kind"],
  "team.deleted": ["teamId"],
  "file.uploaded": ["fileId", "mime", "sizeBytes"],
  "file.scanned": ["fileId", "status"],
  "file.deleted": ["fileId"],
  "integration.connected": ["integrationId", "provider"],
  "integration.disconnected": ["integrationId", "provider"],
} as const satisfies Partial<Record<EventType, readonly string[]>>

export const WEBHOOK_EVENT_TYPES = Object.keys(PROJECTION) as (keyof typeof PROJECTION)[]
export const isWebhookEvent = (t: string): t is (typeof WEBHOOK_EVENT_TYPES)[number] => Object.hasOwn(PROJECTION, t)

type Primitive = string | number | boolean | null

/** The ids-only projection of an event payload (only the listed keys, only primitive values). */
export function projectData(type: (typeof WEBHOOK_EVENT_TYPES)[number], payload: Record<string, unknown>): Record<string, Primitive> {
  const out: Record<string, Primitive> = {}
  for (const k of PROJECTION[type]) {
    const v = payload[k]
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v
  }
  return out
}

/** The signed body (stable: the same JSON on every retry). */
export function envelope(e: DomainEvent & { type: (typeof WEBHOOK_EVENT_TYPES)[number] }) {
  return { id: e.id, type: e.type, occurredAt: e.occurredAt.toISOString(), tenantId: e.tenantId, data: projectData(e.type, e.payload) }
}
