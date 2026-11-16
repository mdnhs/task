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

/** Modules that govern users, roles and the audit trail (R24). Escalation is judged on these only; add `billing` here when it exists. */
export const ADMIN_MODULES = ["settings", "audit"] as const

/**
 * No-escalation rule (R24): the ADMINISTRATIVE modules where `target` grants MORE than `actor` holds
 * (rank none < read < write; a module missing from the actor counts as "none"). Operational modules never count.
 */
export function exceeds(actor: Record<string, string>, target: Record<string, string>): string[] {
  return (ADMIN_MODULES as readonly string[]).filter((m) => m in target && (RANK[target[m]] ?? 0) > (RANK[actor[m] ?? "none"] ?? 0))
}
