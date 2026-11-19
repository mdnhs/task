import type { Qualification, RosterLocation, RosterMember, ShiftType } from "./types"

// Locations admin on the API (B8 Task 22; FR-RS-01..04, 30, 34). Pure helpers for the forms: what is typed stays text until it is checked, and a save sends the record's `version` plus
// ONLY the fields that changed (the API's optimistic lock, R8-9). Nothing here decides who may see what: the people, the locations and the expiry states are the API's.

export const DAYS = [
  { key: "mon", day: 1, label: "Mon" }, { key: "tue", day: 2, label: "Tue" }, { key: "wed", day: 3, label: "Wed" }, { key: "thu", day: 4, label: "Thu" },
  { key: "fri", day: 5, label: "Fri" }, { key: "sat", day: 6, label: "Sat" }, { key: "sun", day: 0, label: "Sun" },
] as const
export type DayKey = (typeof DAYS)[number]["key"]

/** The location form as typed. `hours` is one line per weekday (free text the API stores and shows; nothing computes with it). An empty zone means the organisation's zone. */
export type LocationForm = {
  name: string; address: string; lat: string; lng: string; radius: string; contact: string; timeZone: string; hours: Record<DayKey, string>; delegated: boolean
}
export type LocationErrors = Partial<Record<"name" | "address" | "lat" | "lng" | "radius" | "timeZone", string>>

const text = (n: number | null) => (n === null ? "" : String(n))
export function formOf(l?: RosterLocation): LocationForm {
  const hours = Object.fromEntries(DAYS.map((d) => [d.key, l?.openingHours[d.key] ?? ""])) as Record<DayKey, string>
  return {
    name: l?.name ?? "", address: l?.address ?? "", lat: text(l?.lat ?? null), lng: text(l?.lng ?? null), radius: l ? text(l.zoneRadiusM) : "150", contact: l?.contact ?? "",
    timeZone: l?.timeZone ?? "", hours, delegated: l?.swapApprovalDelegated ?? false,
  }
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.trim()))
const HOURS = /^\d{2}:\d{2}-\d{2}:\d{2}$/

/** Checks what the API would refuse, in words a person can act on. A point is both coordinates or neither (the API's rule); the radius is 0..5000 m. */
export function validateLocation(f: LocationForm): LocationErrors {
  const e: LocationErrors = {}
  if (!f.name.trim()) e.name = "Enter a name"
  else if (f.name.trim().length > 200) e.name = "200 characters at most"
  if (f.address.trim().length > 300) e.address = "300 characters at most"
  const lat = num(f.lat)
  const lng = num(f.lng)
  if (lat !== null && !(lat >= -90 && lat <= 90)) e.lat = "-90 to 90"
  if (lng !== null && !(lng >= -180 && lng <= 180)) e.lng = "-180 to 180"
  if ((lat === null) !== (lng === null) && !e.lat && !e.lng) e[lat === null ? "lat" : "lng"] = "Add both or neither"
  const r = num(f.radius)
  if (r !== null && !(Number.isInteger(r) && r >= 0 && r <= 5000)) e.radius = "0 to 5000 m"
  if (f.timeZone.trim() && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(f.timeZone.trim())) e.timeZone = "e.g. Europe/Dublin"
  return e
}
/** A day's line that does not look like "08:00-22:00" is still saved as typed (the API keeps free text); this only says which ones look odd. */
export const oddHours = (f: LocationForm): DayKey[] => DAYS.filter((d) => f.hours[d.key].trim() !== "" && !HOURS.test(f.hours[d.key].trim())).map((d) => d.key)

type LocationFields = {
  name: string; address: string; lat: number | null; lng: number | null; zoneRadiusM: number | null; openingHours: Record<string, string>; contact: string; swapApprovalDelegated: boolean; timeZone: string | null
}
function fieldsOf(f: LocationForm, base?: RosterLocation): LocationFields {
  // Keys the form does not show (an `all` line from an import) are kept as they are.
  const kept = Object.fromEntries(Object.entries(base?.openingHours ?? {}).filter(([k]) => !DAYS.some((d) => d.key === k)))
  const hours = { ...kept, ...Object.fromEntries(DAYS.filter((d) => f.hours[d.key].trim()).map((d) => [d.key, f.hours[d.key].trim()])) }
  return {
    name: f.name.trim(), address: f.address.trim(), lat: num(f.lat), lng: num(f.lng), zoneRadiusM: num(f.radius), openingHours: hours, contact: f.contact.trim(),
    swapApprovalDelegated: f.delegated, timeZone: f.timeZone.trim() || null,
  }
}

/**
 * Equality that ignores object key order (Task 23 review I1): the API returns jsonb (keys ordered by length, then bytes) while the form builds mon..sun, so a plain
 * JSON.stringify compare saw a change on every save and sent openingHours back, reverting another session's edit. Arrays keep their order.
 */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : typeof v === "object" && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

/** The body of POST /v1/locations. */
export const createBody = (f: LocationForm): LocationFields => fieldsOf(f)

/** The body of PATCH /v1/locations/{id}: `version` (the copy the form was opened on, or the one "Keep mine" took over) and only what differs from `base`. Null when nothing changed. */
export function patchBody(f: LocationForm, base: RosterLocation, version: number): (Partial<LocationFields> & { version: number }) | null {
  const next = fieldsOf(f, base)
  const was: LocationFields = {
    name: base.name, address: base.address, lat: base.lat, lng: base.lng, zoneRadiusM: base.zoneRadiusM, openingHours: base.openingHours, contact: base.contact,
    swapApprovalDelegated: base.swapApprovalDelegated, timeZone: base.timeZone,
  }
  const changed = (Object.keys(next) as (keyof LocationFields)[]).filter((k) => !sameValue(next[k], was[k]))
  if (changed.length === 0) return null
  return { version, ...Object.fromEntries(changed.map((k) => [k, next[k]])) }
}

/**
 * "Keep mine" after a conflict (O1; Task 22 review I1): a three-way merge of what is typed (`mine`) with the copy it was opened on (`base`) and the newer saved copy (`theirs`). A field I changed
 * since `base` keeps my value; a field I did not touch takes theirs, so the next save (diffed against theirs) sends only my edits and never writes their change of another field back over. Plain
 * objects (opening hours per day, targets per weekday) merge one level down; arrays and scalars are one value.
 */
export function keepMine<T extends Record<string, unknown>>(mine: T, base: T, theirs: T): T {
  const same = sameValue
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(theirs)) {
    const [m, b, t] = [mine[k], base[k], theirs[k]]
    out[k] = plain(m) && plain(b) && plain(t) ? keepMine(m, b, t) : same(m, b) ? t : m
  }
  return out as T
}
/** The same merge for a set (the picked supervisors): theirs, plus what I added, minus what I removed. */
export function keepMineSet(mine: string[], base: string[], theirs: string[]): string[] {
  const added = mine.filter((x) => !base.includes(x))
  const removed = base.filter((x) => !mine.includes(x))
  return [...new Set([...theirs, ...added])].filter((x) => !removed.includes(x))
}

/**
 * The supervisor picker. `people` are the active people the API lets this caller pick (already cut to their sites); a current supervisor the caller cannot see is never named or listed, only
 * COUNTED (`hidden`), and is kept on save (`saveIds`): the caller cannot remove someone they cannot see.
 */
export function supervisorChoice(members: RosterMember[], current: string[]): { people: { id: string; name: string }[]; hidden: string[] } {
  const known = new Set(members.map((m) => m.id))
  return { people: members.filter((m) => m.active || current.includes(m.id)).map((m) => ({ id: m.id, name: m.name })), hidden: current.filter((id) => !known.has(id)) }
}
export const saveIds = (picked: string[], hidden: string[]): string[] => [...new Set([...picked, ...hidden])]
export const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

/** A shift type as typed in its card. Targets per weekday as text ("" = 0). */
export type TypeDraft = { name: string; role: string; start: string; end: string; breakMin: string; requires: string[]; targets: Record<number, string> }
export function draftOf(t?: ShiftType): TypeDraft {
  return {
    name: t?.name ?? "", role: t?.role ?? "", start: t?.start ?? "09:00", end: t?.end ?? "17:00", breakMin: t ? String(t.unpaidBreakMin) : "30", requires: t?.requires ?? [],
    targets: Object.fromEntries(DAYS.map((d) => {
      const c = t?.targets.find((x) => x.weekday === d.day)?.count ?? 0
      return [d.day, c > 0 ? String(c) : ""]
    })),
  }
}
export function validateType(d: TypeDraft): string | null {
  const brk = Number(d.breakMin || "0")
  if (!d.name.trim() || !d.role.trim()) return "Name and role"
  if (d.start === d.end) return "Start and end differ"
  if (!Number.isInteger(brk) || brk < 0 || brk > 480) return "Break 0 to 480 min"
  if (DAYS.some((x) => d.targets[x.day] && !(Number(d.targets[x.day]) >= 0 && Number(d.targets[x.day]) <= 99))) return "Targets 0 to 99"
  return null
}
const typeFields = (d: TypeDraft) => ({ name: d.name.trim(), role: d.role.trim(), start: d.start, end: d.end, unpaidBreakMin: Number(d.breakMin || "0"), requires: d.requires })
export const typeCreateBody = (d: TypeDraft) => typeFields(d)
/** PATCH /v1/shift-types/{id}: the type's `version` and only what changed; null when only the targets (or nothing) changed. */
export function typePatchBody(d: TypeDraft, t: ShiftType): (Partial<ReturnType<typeof typeFields>> & { version: number }) | null {
  const next = typeFields(d)
  const was = { name: t.name, role: t.role, start: t.start, end: t.end, unpaidBreakMin: t.unpaidBreakMin, requires: t.requires }
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => !sameValue(next[k], was[k]))
  return changed.length ? { version: t.version, ...Object.fromEntries(changed.map((k) => [k, next[k]])) } : null
}
/** The whole target set for PUT /v1/shift-types/{id}/targets (weekdays with a count above 0), or null when it equals the saved one. */
export function targetsBody(d: TypeDraft, t?: ShiftType): { weekday: number; count: number }[] | null {
  const next = DAYS.map((x) => ({ weekday: x.day, count: Number(d.targets[x.day] || "0") })).filter((x) => x.count > 0).sort((a, b) => a.weekday - b.weekday)
  const was = (t?.targets ?? []).filter((x) => x.count > 0).map((x) => ({ weekday: x.weekday, count: x.count })).sort((a, b) => a.weekday - b.weekday)
  return JSON.stringify(next) === JSON.stringify(was) ? null : next
}
/**
 * What a saved shift type offers. The API NEVER deletes a type (DELETE archives it: shifts already rostered keep reading it), so a saved one shows Archive, never Delete; an archived one shows
 * nothing to do. Only a card that was never saved can be removed (it exists in this browser only).
 */
export const typeAction = (t: ShiftType | undefined): "remove" | "archive" | "none" => (!t ? "remove" : t.archived ? "none" : "archive")

/** The licence editor's rows, as the API judged them. The state comes ONLY from `expired` / `dueSoon` (the API's clock), never from comparing dates here. */
export type QualState = "expired" | "due" | "valid" | "open"
export const qualState = (q: Qualification): QualState => (q.expired ? "expired" : q.dueSoon ? "due" : q.expiresOn === null ? "open" : "valid")
/** Draft rows of the editor: a type and an expiry date ("" = none). The expiry state of an edited row is unknown until the API answers. */
export type QualDraft = { type: string; expiresOn: string }
/** Licence keys compare case-insensitively and trimmed (the API's canonical key is lower-case; rows written before that rule keep their case). */
export const sameKey = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
export const qualDrafts = (qs: Qualification[]): QualDraft[] => qs.map((q) => ({ type: q.type, expiresOn: q.expiresOn ?? "" }))
export function validateQuals(rows: QualDraft[]): string | null {
  const keys = rows.map((r) => r.type.trim().toLowerCase())
  if (keys.some((k) => !k)) return "Name every licence"
  if (keys.some((k) => k.length > 80)) return "80 characters at most"
  if (new Set(keys).size !== keys.length) return "Each licence once"
  if (rows.length > 50) return "50 at most"
  return null
}
export const qualBody = (rows: QualDraft[]) => rows.map((r) => ({ type: r.type.trim(), expiresOn: r.expiresOn || null }))
