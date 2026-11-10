import type { RosterAccess } from "@/lib/roster-access"
import type { Location } from "@/lib/rosters"

// Store scope keys and merges shared by the roster pages (pure). The in-memory stores reseed when the scope key changes, so every page that
// shares a store must agree on the key: it lives here, in one place.

/** Key of the stores the Rosters page, the Locations pages and the exchange (claims, swaps) share: one per tenant and role. */
export const rosterScopeKey = (tenantId: string, roleId: string): string => `${tenantId}:${roleId}`
/** Key of the stores only My roster uses (confirmations, leave, availability). */
export const mineScopeKey = (tenantId: string, roleId: string): string => `${rosterScopeKey(tenantId, roleId)}:mine`
/** The shared key behind a My roster key: claims and swaps are one list on both pages, so an approval on Rosters shows on My roster. */
export const exchangeScopeKey = (mineKey: string): string => mineKey.replace(/:mine$/, "")

/**
 * The stored list wins; whatever the server list has that the store lacks (by id) is added. Whichever page seeds a shared store first, the
 * other page tops it up with its own rows without undoing edits. Returns `stored` itself when nothing is missing.
 */
export function mergeById<T extends { id: string }>(stored: T[], server: T[]): T[] {
  const have = new Set(stored.map((x) => x.id))
  const missing = server.filter((x) => !have.has(x.id))
  return missing.length ? [...stored, ...missing] : stored
}

/** Locations as the Rosters page shows them: the server list topped up with the ones added or renamed in this session (the stored copy wins). */
export const mergeLocations = (server: Location[], stored: Location[] | undefined): Location[] => (stored ? mergeById(stored, server) : server)

/** A location added in this session has no grant on the server yet: an office role that sees every location may open it. Others keep their list. */
export function withNewLocations(access: RosterAccess, serverLocations: Location[], merged: Location[]): RosterAccess {
  if (access.scope !== "all" || !access.editPublished || !access.locationIds) return access
  const known = new Set(serverLocations.map((l) => l.id))
  const added = merged.filter((l) => !known.has(l.id) && !access.locationIds!.includes(l.id)).map((l) => l.id)
  return added.length ? { ...access, locationIds: [...access.locationIds, ...added] } : access
}
