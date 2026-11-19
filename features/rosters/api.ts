import { getData } from "@/lib/data"
import { canSeeLocation, seesAllLocations, type LocationGrant, type RosterAccess } from "@/lib/roster-access"
import type { Availability, LeaveRequest, RuleId, RuleSeverity } from "@/lib/roster-rules"
import { getWorkforce, type WorkforceMember } from "@/lib/workforce"
import type { HistoryEntry, Location, RosterShift, RosterWeek, ShiftTemplate, StaffingTarget } from "@/lib/rosters"
import { canApproveLeave, combinedRoster } from "./self-service"
import { eligible } from "./editing"
import type { Claim, LeaveQueue, LocationAdminData, MyExchange, MyRosterData, SwapRequest } from "./types"

/** People for a caller who does not see every location: a supervisor gets no home at all, an office role with an `except` keeps the home of visible locations only. */
export function cutMembers(access: RosterAccess, members: WorkforceMember[], shifts: RosterShift[], templates: ShiftTemplate[]): WorkforceMember[] {
  return scopedMembers(members, shifts, templates, access.scope === "locations" ? undefined : (access.locationIds ?? []))
}

/**
 * Callers who do not see every location (supervisors, office roles with an `except`): only people on an in-scope shift (so leavers still resolve by id) or holding a licence an in-scope template
 * requires (for suggestions), and for an office role with an `except` also people whose home is a visible location. Qualifications are cut to the
 * required types; the home location is dropped, except a visible one for the office role, so nothing about a hidden site leaks.
 */
export function scopedMembers(members: WorkforceMember[], shifts: RosterShift[], templates: ShiftTemplate[], visibleHomes?: string[]): WorkforceMember[] {
  const onShift = new Set(shifts.map((s) => s.personId).filter((p): p is string => !!p))
  const required = new Set(templates.flatMap((t) => t.requires))
  const homeOk = (m: WorkforceMember) => !!visibleHomes && !!m.homeLocationId && visibleHomes.includes(m.homeLocationId)
  return members
    .map((m) => ({ ...m, homeLocationId: homeOk(m) ? m.homeLocationId : null, qualifications: m.qualifications.filter((q) => required.has(q.type)) }))
    .filter((m) => onShift.has(m.id) || m.homeLocationId !== null || m.qualifications.length > 0)
}

/** Server only. Change history for the permitted locations (FR-RS audit trail). */
export async function getRosterHistory(access: RosterAccess): Promise<HistoryEntry[]> {
  if (access.scope === "none" || access.scope === "own") return []
  const ids = new Set(access.locationIds ?? [])
  const { history } = await getData<{ history: HistoryEntry[] }>("rosters/history.json")
  return history.filter((h) => ids.has(h.locationId))
}

/** Server only. Locations admin payload: limited to the permitted locations, and grants only for those locations. Callers gate on `editPublished`. */
export async function getLocationAdminData(access: RosterAccess): Promise<LocationAdminData> {
  const empty: LocationAdminData = { locations: [], templates: [], targets: [], shifts: [], grants: [], members: [], skills: [], history: [] }
  if (!access.editPublished) return empty
  const ids = new Set(access.locationIds ?? [])
  const [{ locations }, { templates }, { targets }, { shifts }, { grants }, members] = await Promise.all([
    getData<{ locations: Location[] }>("rosters/locations.json"),
    getData<{ templates: ShiftTemplate[] }>("rosters/templates.json"),
    getData<{ targets: StaffingTarget[] }>("rosters/targets.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
    getData<{ grants: LocationGrant[] }>("rosters/access.json"),
    getWorkforce(),
  ])
  const inScope = { templates: templates.filter((t) => ids.has(t.locationId)), shifts: shifts.filter((s) => ids.has(s.locationId)) }
  const skills = [...new Set([...members.flatMap((m) => m.qualifications.map((q) => q.type)), ...templates.flatMap((t) => t.requires)])].sort()
  return {
    locations: locations.filter((l) => ids.has(l.id)),
    templates: inScope.templates,
    targets: targets.filter((t) => ids.has(t.locationId)),
    shifts: inScope.shifts,
    grants: grants.filter((g) => ids.has(g.locationId)),
    members: seesAllLocations(access, locations.map((l) => l.id)) ? members : cutMembers(access, members, inScope.shifts, inScope.templates),
    skills,
    history: await getRosterHistory(access),
  }
}

export type WeekData = {
  rules: { avgWeekReferenceWeeks: number; severity: Record<RuleId, RuleSeverity> }
  leave: LeaveRequest[]
  availability: Availability[]
  shifts: RosterShift[]
  weeks: RosterWeek[]
  templates: ShiftTemplate[]
  members: WorkforceMember[]
  allLocationIds: string[]
}

/**
 * Server only. One person's own roster (FR-RS-33): published shifts across all locations, their own leave and availability. The person comes
 * from the session, never a query. Nothing about anyone else is in the payload.
 */
export async function getMyRoster(personId: string): Promise<MyRosterData> {
  const [{ locations }, { weeks }, { shifts }, { leave }, { availability }] = await Promise.all([
    getData<{ locations: Location[] }>("rosters/locations.json"),
    getData<{ weeks: RosterWeek[] }>("rosters/weeks.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
    getData<{ leave: LeaveRequest[] }>("rosters/leave.json"),
    getData<{ availability: Availability[] }>("rosters/availability.json"),
  ])
  const mine = combinedRoster(personId, shifts, weeks)
  const locs = new Set(mine.map((s) => s.locationId))
  const wks = new Set(mine.map((s) => s.weekId))
  return {
    shifts: mine,
    weeks: weeks.filter((w) => wks.has(w.id)),
    locations: locations.filter((l) => locs.has(l.id)),
    leave: leave.filter((l) => l.personId === personId),
    availability: availability.filter((a) => a.personId === personId),
  }
}

/** Server only. Leave waiting for a decision from people the caller may decide for (D8). Names are sent for those people only. */
export async function getLeaveQueue(access: RosterAccess, me: string): Promise<LeaveQueue> {
  if (access.scope !== "all" && access.scope !== "locations") return { leave: [], names: {} }
  const [{ leave }, members, { locations }, { shifts }] = await Promise.all([
    getData<{ leave: LeaveRequest[] }>("rosters/leave.json"),
    getWorkforce(),
    getData<{ locations: { id: string }[] }>("rosters/locations.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
  ])
  const byId = new Map(members.map((m) => [m.id, m]))
  // An office role with an `except` decides only for people tied to the locations it sees: a home at an excepted site, or working only there, is out.
  const full = seesAllLocations(access, locations.map((l) => l.id))
  const hidden = new Set(shifts.filter((s) => s.personId && !canSeeLocation(access, s.locationId)).map((s) => s.personId!))
  const visible = new Set(shifts.filter((s) => s.personId && canSeeLocation(access, s.locationId)).map((s) => s.personId!))
  const tied = (m: WorkforceMember) => full || access.scope !== "all" || (m.homeLocationId ? canSeeLocation(access, m.homeLocationId) : visible.has(m.id) || !hidden.has(m.id))
  const rows = leave.filter((l) => l.status === "requested" && l.personId !== me && byId.has(l.personId) && canApproveLeave(access, byId.get(l.personId)!) && tied(byId.get(l.personId)!))
  return { leave: rows, names: Object.fromEntries(rows.map((l) => [l.personId, byId.get(l.personId)!.name])) }
}

/**
 * Server only. Open shifts and swaps for one person (FR-RS-38/42). Open shifts: published weeks, still to come, at a location where the person
 * is rostered or has their home, and only where their licences qualify. Co-workers for a swap: id and name only, eligible for that shift and
 * working at (or based at) that location. Nothing else about anyone else is sent. `today` is the tenant wall clock.
 */
export async function getMyExchange(personId: string, today: string): Promise<MyExchange> {
  const [{ locations }, { weeks }, { shifts }, { templates }, { claims }, { swaps }, members] = await Promise.all([
    getData<{ locations: Location[] }>("rosters/locations.json"),
    getData<{ weeks: RosterWeek[] }>("rosters/weeks.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
    getData<{ templates: ShiftTemplate[] }>("rosters/templates.json"),
    getData<{ claims: Claim[] }>("rosters/claims.json"),
    getData<{ swaps: SwapRequest[] }>("rosters/swaps.json"),
    getWorkforce(),
  ])
  const me = members.find((m) => m.id === personId) ?? null
  const day = today.slice(0, 10)
  const published = new Set(weeks.filter((w) => w.status === "published").map((w) => w.id))
  const live = shifts.filter((s) => published.has(s.weekId))
  const mine = live.filter((s) => s.personId === personId)
  const myLocs = new Set([...mine.map((s) => s.locationId), ...(me?.homeLocationId ? [me.homeLocationId] : [])])
  const tpl = new Map(templates.map((t) => [t.id, t]))
  const open = me
    ? live.filter((s) => s.personId === null && s.date >= day && myLocs.has(s.locationId) && tpl.has(s.templateId) && eligible([me], tpl.get(s.templateId)!, s.date).length > 0)
    : []
  const upcoming = mine.filter((s) => s.date >= day)
  const worksAt = (m: WorkforceMember, locationId: string) => m.homeLocationId === locationId || live.some((s) => s.personId === m.id && s.locationId === locationId)
  const peers: MyExchange["peers"] = {}
  for (const s of upcoming) {
    const t = tpl.get(s.templateId)
    if (!t) continue
    peers[s.id] = eligible(members, t, s.date).filter((m) => m.id !== personId && worksAt(m, s.locationId)).map((m) => ({ id: m.id, name: m.name }))
  }
  const used = new Set([...open, ...upcoming].map((s) => s.templateId))
  const usedLocs = new Set([...open, ...upcoming].map((s) => s.locationId))
  return {
    member: me,
    open,
    templates: templates.filter((t) => used.has(t.id)),
    peers,
    claims: claims.filter((c) => c.personId === personId),
    swaps: swaps.filter((x) => x.fromPersonId === personId),
    locations: locations.filter((l) => usedLocs.has(l.id)).map((l) => ({ id: l.id, name: l.name })),
    weeks: weeks.filter((w) => [...open, ...upcoming].some((s) => s.weekId === w.id)),
  }
}
