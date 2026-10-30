import { PLATFORM_LOCALE } from "./constants"
import { STAFF_ROLE_LABEL } from "./permissions"
import type { AuditEntry, PlatformSeed, PlatformTenant } from "./types"

// The platform audit log (Task 9, /platform/audit, FR-SAAS-10). Immutable: the console only ever appends lines (store.ts
// outbox); nothing here or in the view edits or deletes one. Filtering is logic.ts → filterAudit (one filter, ANDed).

/** Server view model: every line plus tenant names for the tenant filter (D8: no tenant record beyond its name). */
export type AuditLogData = { entries: AuditEntry[]; tenants: Pick<PlatformTenant, "id" | "name">[] }

export const auditLogData = (seed: Pick<PlatformSeed, "audit" | "tenants">): AuditLogData => ({
  entries: seed.audit,
  tenants: seed.tenants.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => collator.compare(a.name, b.name)),
})

const collator = new Intl.Collator(PLATFORM_LOCALE, { sensitivity: "base", numeric: true })
const idNum = (id: string) => parseInt(id.replace(/\D/g, ""), 10) || 0

/** Newest first; lines at the same minute by id (the later id was written later). */
export const sortAudit = (entries: AuditEntry[]) => [...entries].sort((a, b) => b.at.localeCompare(a.at) || idNum(b.id) - idNum(a.id))

/** The distinct actors and actions in the log, A-Z, for the filter menus. */
export function auditOptions(entries: AuditEntry[]): { actors: string[]; actions: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => collator.compare(a, b))
  return { actors: uniq(entries.map((e) => e.actor)), actions: uniq(entries.map((e) => e.action)) }
}

/** One before → after value, short enough for a line. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "none"
  if (typeof v === "object") {
    if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${showValue(x)}`).join(", ")
  }
  return String(v).replaceAll("_", " ")
}

/** The fields a line changed, in order: before → after (only lines that record a change, D7). */
export function auditChanges(e: Pick<AuditEntry, "before" | "after">): { key: string; before: string; after: string }[] {
  if (!e.before && !e.after) return []
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])]
  return keys.map((key) => ({ key, before: showValue(e.before?.[key]), after: showValue(e.after?.[key]) }))
}

/** CSV rows of the filtered log: what a reviewer needs offline, change and reason included. */
export function auditCsvRows(entries: AuditEntry[], names: Map<string, string>): Record<string, string>[] {
  return entries.map((e) => ({
    id: e.id,
    at: e.at,
    actor: e.actor,
    role: e.staffRole ? STAFF_ROLE_LABEL[e.staffRole] : "",
    action: e.action,
    target: e.target,
    tenant: e.tenantId ? (names.get(e.tenantId) ?? e.tenantId) : "",
    detail: e.detail,
    change: auditChanges(e).map((c) => `${c.key}: ${c.before} -> ${c.after}`).join("; "),
    reason: e.reason ?? "",
  }))
}

export const AUDIT_CSV_COLUMNS = [
  { key: "id", label: "Entry" }, { key: "at", label: "When" }, { key: "actor", label: "Actor" }, { key: "role", label: "Staff role" },
  { key: "action", label: "Action" }, { key: "target", label: "Target" }, { key: "tenant", label: "Tenant" }, { key: "detail", label: "Detail" },
  { key: "change", label: "Before -> after" }, { key: "reason", label: "Reason" },
]
