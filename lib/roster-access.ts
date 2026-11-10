import type { Role } from "./types"

// Who sees and edits which location's roster (D4, FR-RS-31/32). Pure: the grants and limits are data (rosters/access.json),
// and servers cut payloads by the result so another location's data never reaches the client.

export type LocationGrant = { locationId: string; personId: string }
export type OfficeLimit = { personId: string; except: string[] }
export type RosterAccess = {
  scope: "all" | "locations" | "own" | "none"
  /** Locations the role may open. null for "own" (no location view, only the person's own shifts). */
  locationIds: string[] | null
  editDraft: boolean
  editPublished: boolean
  approve: boolean
}

const NONE: RosterAccess = { scope: "none", locationIds: [], editDraft: false, editPublished: false, approve: false }

export function rosterAccess(role: Role, personId: string, grants: LocationGrant[], limits: OfficeLimit[], allLocationIds: string[]): RosterAccess {
  const level = role.access.roster
  if (!level || level === "none") return NONE
  const write = level === "write"
  if (write && role.rosterLevel === "supervisor") {
    const mine = new Set(grants.filter((g) => g.personId === personId).map((g) => g.locationId))
    return { scope: "locations", locationIds: allLocationIds.filter((id) => mine.has(id)), editDraft: true, editPublished: false, approve: false }
  }
  if (write && role.rosterLevel === "office") {
    const except = new Set(limits.filter((l) => l.personId === personId).flatMap((l) => l.except))
    return { scope: "all", locationIds: allLocationIds.filter((id) => !except.has(id)), editDraft: true, editPublished: true, approve: true }
  }
  if (role.home === "staff") return { scope: "own", locationIds: null, editDraft: false, editPublished: false, approve: false }
  return { scope: "all", locationIds: [...allLocationIds], editDraft: false, editPublished: false, approve: false }
}

export const canSeeLocation = (a: RosterAccess, locationId: string): boolean => a.locationIds?.includes(locationId) ?? false

/** True when the caller sees every location in `allLocationIds`: no grant cut (supervisor) and no `except` cut (office). Anything less is "limited". */
export const seesAllLocations = (a: RosterAccess, allLocationIds: string[]): boolean => a.scope === "all" && allLocationIds.every((id) => canSeeLocation(a, id))
