import type { Access, Module } from "@opsdesk/domain/permissions"
import type { ResolvedRole } from "../context"

/**
 * Leaf module (no imports of services or middleware, so permission.ts and api-key.ts can both use it without an import cycle):
 * the API-key principal's sentinel identity, its synthetic role and the registry of permission-guard middleware.
 */
export const API_KEY_ROLE_ID = "00000000-0000-0000-0000-00000000a0e1"
export const API_KEY_ROLE_KEY = "apikey"
export const API_KEY_ACTOR_PREFIX = "apikey:"
export const apiKeyActor = (id: string) => `${API_KEY_ACTOR_PREFIX}${id}`

/** Middleware functions that enforce a module permission (requirePermission registers its handlers here). */
const permissionGuards = new WeakSet<object>()
export const markPermissionGuard = <T extends object>(h: T): T => (permissionGuards.add(h), h)
export const isPermissionGuard = (h: unknown): boolean => typeof h === "function" && permissionGuards.has(h)

export function apiKeyRole(k: { access: Record<Module, Access> }): ResolvedRole {
  return Object.freeze({
    id: API_KEY_ROLE_ID, key: API_KEY_ROLE_KEY, label: "API key", description: "Scopes of the key, limited by its creator's current role.",
    home: "manager" as const, access: k.access, fieldRules: Object.freeze({}) as Record<string, string[]>,
  })
}
