// Pure mappers between the settings API's DTOs and the UI's types (B6 T6.5). A missing or mistyped required field THROWS: a renamed field must not become a silent
// "" or 0. Roles are keyed by their KEY everywhere in the UI (ruling I11); the uuid is kept only for the write routes. Instants become the tenant's wall clock.
import { initialsOf } from "@/lib/branding"
import { ApiError, userMessage } from "@/lib/api/problem"
import { wallInTz } from "@/lib/tz"
import type { Access, Module } from "@/lib/types"
import { MATRIX_MODULES } from "./constants"
import type {
  DataRequestRow, DataRequestStatus, Department, Integration, IntegrationStatus, Invite, MatrixRole, Organisation, SettingsUser, SupportGrant,
} from "./types"

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`settings: ${k} must be ${want}`)
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k, "a string"))
const int = (r: Rec, k: string): number => (Number.isInteger(r[k]) ? (r[k] as number) : bad(k, "an integer"))
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k, "a boolean"))
const nstr = (r: Rec, k: string): string | null => (r[k] === null ? null : str(r, k))
const oneOf = <T extends string>(r: Rec, k: string, set: readonly T[]): T => (set.includes(r[k] as T) ? (r[k] as T) : bad(k, `one of ${set.join(", ")}`))
const rec = (v: unknown, what: string): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : bad(what, "an object"))
const wall = (iso: string, tz: string) => wallInTz(iso, tz)
const nwall = (iso: string | null, tz: string) => (iso === null ? null : wallInTz(iso, tz))

// ---- organisation ----

export function toOrganisation(dto: unknown): Organisation {
  const r = rec(dto, "organisation")
  return { name: str(r, "name"), slug: str(r, "slug"), timezone: str(r, "timezone"), currency: str(r, "currency"), locale: str(r, "locale"), reportDeadline: str(r, "reportDeadline"), reportDueAfterMinutes: int(r, "reportDueAfterMinutes") }
}

/** The PATCH body: only the fields that changed (an unchanged field is never re-sent, so an audit entry only appears for a real change). The slug is never sent. */
export function organisationPatch(cur: Organisation, form: { name: string; timezone: string; reportDeadline: string }): Partial<Pick<Organisation, "name" | "timezone" | "reportDeadline">> {
  const out: Partial<Pick<Organisation, "name" | "timezone" | "reportDeadline">> = {}
  const name = form.name.trim()
  if (name !== cur.name) out.name = name
  if (form.timezone !== cur.timezone) out.timezone = form.timezone
  if (form.reportDeadline !== cur.reportDeadline) out.reportDeadline = form.reportDeadline
  return out
}

export type FormField = "name" | "timezone" | "reportDeadline" | "color" | "logo"
const FIELD_OF: Record<string, FormField> = { invalid_name: "name", invalid_timezone: "timezone", invalid_report_deadline: "reportDeadline", invalid_color: "color", invalid_logo: "logo" }

/** A refusal about one form field becomes that field's error (the mapped copy, never the server's text); anything else is not a field error (the caller toasts it). */
export function fieldErrorOf(e: unknown): { field: FormField; message: string } | null {
  if (!(e instanceof ApiError)) return null
  const field = FIELD_OF[e.code]
  return field ? { field, message: userMessage(e).text } : null
}

// ---- departments, people, roles ----

export function toDepartments(teams: readonly { id: string; name: string; kind: string; memberIds: readonly string[] }[]): Department[] {
  return teams.filter((t) => t.kind === "department").map((t) => ({ id: t.id, name: t.name, members: t.memberIds.length }))
}

const LEVELS = ["none", "read", "write"] as const
export function toRoles(dtos: readonly unknown[]): MatrixRole[] {
  return dtos.map((d) => {
    const r = rec(d, "role")
    const raw = rec(r.access, "access")
    const access = Object.fromEntries(MATRIX_MODULES.map((m) => [m, (LEVELS as readonly unknown[]).includes(raw[m]) ? (raw[m] as Access) : "none"])) as Record<Module, Access>
    const key = str(r, "key")
    // Built-in (template) roles are read-only in the API (409 template_locked): only a copy can be edited, and the owner is always fixed.
    return { id: key, uuid: str(r, "id"), label: str(r, "label"), access, locked: key === "owner" || r.isTemplate === true }
  })
}

/** The write routes take a role's uuid; the UI holds its key. An unknown key is a programming error, never a silent default. */
export function roleUuid(roles: readonly MatrixRole[], key: string): string {
  const r = roles.find((x) => x.id === key)
  if (!r) throw new Error(`settings: unknown role "${key}"`)
  return r.uuid
}

const FORMER = "Former member"
const isErased = (p: { name: string; email: string }) => p.name.trim() === "Erased user" || /^erased\+.+@invalid$/i.test(p.email)

export function toUsers(people: readonly { userId: string; name: string; email: string; roleKey: string }[], deptOf: (userId: string) => string): SettingsUser[] {
  return people.map((p) => ({ id: p.userId, name: isErased(p) ? FORMER : p.name.trim() || p.email.split("@")[0]! || FORMER, email: p.email, role: p.roleKey, dept: deptOf(p.userId) }))
}

export function toInvites(dto: { items: readonly unknown[] }, tz: string): Invite[] {
  return dto.items.map((d) => {
    const r = rec(d, "invite")
    return { id: str(r, "id"), email: str(r, "email"), role: str(r, "roleKey"), createdAt: wall(str(r, "createdAt"), tz), expiresAt: wall(str(r, "expiresAt"), tz), invitedBy: str(r, "invitedBy") }
  })
}

// ---- devices ----

const TYPES = ["pc", "android", "browser"] as const
const OWNERS = ["company", "personal"] as const
export function toDevice(dto: unknown, tz: string) {
  const r = rec(dto, "device")
  return { id: str(r, "id"), userId: str(r, "userId"), type: oneOf(r, "type", TYPES), owner: oneOf(r, "owner", OWNERS), label: str(r, "label"), trusted: bool(r, "trusted"), lastSeen: nwall(nstr(r, "lastSeen"), tz) }
}

// ---- integrations, grants, data requests ----

const INTEGRATION_STATUS: Record<string, IntegrationStatus> = { connected: "connected", error: "error", revoked: "not_connected" }
export function toIntegration(dto: unknown, tz: string): Integration {
  const r = rec(dto, "integration")
  const provider = str(r, "provider")
  const status = INTEGRATION_STATUS[str(r, "status")] ?? bad("status", "connected, error or revoked")
  const at = nwall(nstr(r, "lastRefreshAt"), tz) ?? wall(str(r, "connectedAt"), tz)
  return {
    id: str(r, "id"), name: provider === "google" ? "Google Drive" : provider, icon: "folder", status, account: nstr(r, "accountEmail"),
    description: "Opens Drive files from tasks and reports. Read-only.",
    lastEvent: status === "connected" ? "Connected" : status === "error" ? "Sign-in needs renewing" : "Disconnected", lastEventAt: at,
    policy: "Drive links only open on devices your policy allows.",
  }
}

export function toGrant(dto: unknown, tz: string): SupportGrant {
  const r = rec(dto, "grant")
  return {
    id: str(r, "id"), who: nstr(r, "staffName") ?? "OpsDesk Support", reason: str(r, "reason"), status: oneOf(r, "status", ["active", "expired", "revoked"] as const),
    startsAt: wall(str(r, "startsAt"), tz), expiresAt: wall(str(r, "expiresAt"), tz), revokedAt: nwall(nstr(r, "revokedAt"), tz),
  }
}

const DSR_STATUS = ["pending", "running", "completed", "rejected", "failed"] as const satisfies readonly DataRequestStatus[]
export function toDataRequest(dto: unknown, tz: string, nameOf: (userId: string) => string): DataRequestRow {
  const r = rec(dto, "data request")
  const subjectId = str(r, "subjectUserId")
  return {
    id: str(r, "id"), subjectId, subject: nameOf(subjectId), kind: oneOf(r, "kind", ["export", "erase", "correct"] as const), status: oneOf(r, "status", DSR_STATUS),
    overdue: bool(r, "overdue"), createdAt: wall(str(r, "createdAt"), tz), dueAt: wall(str(r, "dueAt"), tz), completedAt: nwall(nstr(r, "completedAt"), tz), resultFileId: nstr(r, "resultFileId"),
  }
}

export { initialsOf }
