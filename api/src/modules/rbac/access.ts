import { z } from "@hono/zod-openapi"
import type { Module } from "@opsdesk/domain/permissions"

export const MODULES = [
  "dashboard", "tasks", "reports", "attention", "staff", "shifts", "recruitment", "files", "payroll", "orders", "settings", "audit", "roster",
] as const satisfies readonly Module[]
export const LEVELS = ["none", "read", "write"] as const
const RANK: Record<string, number> = { none: 0, read: 1, write: 2 }

export const AccessPatch = z.partialRecord(z.enum(MODULES), z.enum(LEVELS))
export const FieldRules = z.record(
  z.string().regex(/^[A-Za-z][\w-]{0,63}$/),
  z.array(z.string().regex(/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/).max(128)).max(100),
)

/**
 * No-escalation rule: the modules where `target` grants MORE than `actor` holds (rank none < read < write).
 * Empty = the actor may hand `target` out. A module missing from the actor counts as "none".
 */
export function exceeds(actor: Record<string, string>, target: Record<string, string>): string[] {
  return Object.entries(target)
    .filter(([m, level]) => (RANK[level] ?? 0) > (RANK[actor[m] ?? "none"] ?? 0))
    .map(([m]) => m)
}
