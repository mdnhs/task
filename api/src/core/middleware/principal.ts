import type { Access, Module } from "@opsdesk/domain/permissions"
import type { Context } from "hono"
import type { AppEnv, ResolvedRole } from "../context"

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

/** The creator's real role identity, read fresh at use time (it decides data scope: people/report visibility follow it). */
export type CreatorRole = { id: string; key: string; home: "staff" | "manager"; fieldRules: Record<string, string[]> }
/** Fail closed: an unknown `home` is the narrowest ("staff" = own data only). */
export const homeOf = (h: unknown): "staff" | "manager" => (h === "manager" ? "manager" : "staff")

/**
 * The synthetic role of an API key: module access = scopes ∩ the creator's current permissions (computed by the caller), but the
 * role IDENTITY (id, key, home, field rules) is the creator's real one, so every data-scope rule that resolves from the role
 * (reportScope / peopleAccess / cloned_from ceilings, field rules) gives the key exactly what the creator would see, never wider.
 * The member stays the `apikey:<id>` sentinel; scope handlers take the creator's user id from c.var.apiKey.creatorId.
 */
export function apiKeyRole(k: { access: Record<Module, Access>; role: CreatorRole }): ResolvedRole {
  return Object.freeze({
    id: k.role.id, key: k.role.key, label: "API key", description: "Scopes of the key, limited by its creator's current role.",
    home: k.role.home, access: k.access, fieldRules: Object.freeze({ ...k.role.fieldRules }) as Record<string, string[]>,
  })
}

/** Whose data "me" means: the creator for an API key (a key sees what its creator would), else the signed-in member (or the support staff id). */
export function subjectUserId(c: Context<AppEnv>): string {
  return c.get("apiKey")?.creatorId ?? c.get("member")!.userId
}

/** Who DID it, for history and audit rows: `apikey:<id>` for a key, else the member's user id. */
export function actorIdOf(c: Context<AppEnv>): string {
  const k = c.get("apiKey")
  return k ? apiKeyActor(k.id) : c.get("member")!.userId
}
