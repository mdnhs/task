import type { LocationGrant } from "@/lib/roster-access"
import type { HistoryEntry, RosterShift } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"

// Locations admin (FR-RS-01..04, 30, 32, 34). Pure helpers: the form's checks, the template-in-use rule, supervisor grants and their audit line.

/** The location form as typed: numbers stay strings until validated. */
export type LocationForm = { name: string; address: string; lat: string; lng: string; radius: string; openingHours: string; contact: string }
export type LocationErrors = Partial<Record<keyof LocationForm, string>>

const num = (v: string) => (v.trim() === "" ? NaN : Number(v))

export function validateLocation(f: LocationForm): LocationErrors {
  const e: LocationErrors = {}
  if (f.name.trim().length < 2) e.name = "Enter a name"
  if (!f.address.trim()) e.address = "Enter an address"
  const lat = num(f.lat)
  const lng = num(f.lng)
  if (!(lat >= -90 && lat <= 90)) e.lat = "Latitude is between -90 and 90"
  if (!(lng >= -180 && lng <= 180)) e.lng = "Longitude is between -180 and 180"
  const r = num(f.radius)
  if (!(r > 0)) e.radius = "Enter a radius above 0 m"
  return e
}

/** A template that any shift was built from can't be deleted (FR-RS-02): past rosters would lose their shape. */
export const canDeleteTemplate = (id: string, shifts: RosterShift[]): boolean => !shifts.some((s) => s.templateId === id)

/** Replaces one location's supervisors; other locations' grants are untouched. */
export function setSupervisors(grants: LocationGrant[], locationId: string, people: string[]): { grants: LocationGrant[]; added: string[]; removed: string[] } {
  const next = [...new Set(people)]
  const before = grants.filter((g) => g.locationId === locationId).map((g) => g.personId)
  const added = next.filter((p) => !before.includes(p))
  const removed = before.filter((p) => !next.includes(p))
  return { grants: [...grants.filter((g) => g.locationId !== locationId), ...next.map((personId) => ({ locationId, personId }))], added, removed }
}

/** FR-RS-34: the audit line for a change of who manages a location (location level, so no week or shift). Null when nothing changed. */
export function supervisorHistory(locationId: string, before: string[], after: string[], by: string, at: string, existing: HistoryEntry[]): HistoryEntry | null {
  const same = before.length === after.length && before.every((p) => after.includes(p))
  if (same) return null
  return { id: `h-${String(existing.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`, weekId: null, locationId, shiftId: null, at, by, action: "supervisors.changed", before: { supervisors: before }, after: { supervisors: after }, reason: null }
}

/** Resolves any member by id, including one who has left, so past shifts keep their name. */
export const resolveMember = (members: WorkforceMember[], id: string): WorkforceMember | undefined => members.find((m) => m.id === id)

/** Who can be put on a shift starting on `date`: not someone who left on or before it. */
export const assignableMembers = (members: WorkforceMember[], date: string): WorkforceMember[] => members.filter((m) => m.leftOn === null || date < m.leftOn)
