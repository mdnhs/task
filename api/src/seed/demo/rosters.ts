import { and, eq, sql } from "drizzle-orm"
import {
  leaveRequests, locations, locationSupervisors, memberQualifications, memberships, rosterAvailability, rosterChangeRequests, rosterExchanges, rosterHistory, rosterShifts, rosterWeekTemplates,
  rosterWeeks, roles, shiftTypes, shiftTypeTargets, tenantSettings,
} from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { shiftInstants } from "../../modules/rosters/locations"
import { RULES_SETTING } from "../../modules/rosters/rules"
import { makeAnchor, type Anchor } from "./anchor"
import { detId } from "./ids"
import type { Source } from "./source"

/**
 * The roster tables of the full demo tenant (M1A, B8 Task 18), from public/data/rosters/*.json. Raw inserts with deterministic ids (`detId`, so a re-seed keeps every id: R8-18), the same way the
 * report and task history are seeded: the services need a request context and would stamp today's date on history that is meant to be old. Every date moves by WHOLE WEEKS (J6: a Monday stays a
 * Monday, a weekday stays its weekday, even in `--anchor latest-report` mode, which moves other dates by days) and every wall time is kept: the instants are computed in the location's zone
 * (the tenant's, no zone of its own), so 18:00 is 18:00 on both sides of a clock change.
 *
 * Also the DEMO PERSONAS that can work with rosters (the base role templates are untouched): the demo tenant's `ops` role gets roster level `office` (all sites) and the `supervisor` role roster level
 * `supervisor`, both with roster write, so Lilianna Novak (all-scope manager) edits every site, and Ismail Rahman (Coppers) and Daniel Okafor (Docklands), who hold the supervisor grants of
 * rosters/access.json, edit only theirs. The owner and the admin are office by their templates. See docs/deploy/demo-seed.md.
 */
export type RosterRun = {
  tenantId: string
  tz: string
  now: Date
  /** The roster anchor: the weekday-bound anchor rounded down to whole weeks. */
  anchor: Anchor
  actorId: string
  src: Source
  userOfMock: (personId: string) => string
}

/** The whole-week anchor the roster files move by (the report anchor can be a number of days in `latest-report` mode). */
export const rosterAnchor = (src: Source, weekAnchor: Anchor, tz: string): Anchor =>
  makeAnchor({ mockToday: src.org.today, anchor: weekAnchor.today, tz, offsetDays: 7 * Math.floor(weekAnchor.offsetDays / 7) })

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
/** "Mon-Sat 08:00-22:00" -> { mon: "08:00-22:00", ..., sat: "08:00-22:00" }. A line that does not parse is kept whole under `all`. */
export function openingHoursOf(text: string): Record<string, string> {
  const m = /^(\w{3})(?:-(\w{3}))? (\d\d:\d\d-\d\d:\d\d)$/.exec(text.trim())
  const a = m ? DAYS.indexOf(m[1].toLowerCase()) : -1
  const b = m ? DAYS.indexOf((m[2] ?? m[1]).toLowerCase()) : -1
  if (!m || a < 0 || b < a) return { all: text }
  return Object.fromEntries(DAYS.slice(a, b + 1).map((d) => [d, m[3]]))
}

export async function seedRosters(tx: TenantTx, run: RosterRun): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  const { tenantId, tz, now, anchor, actorId, src, userOfMock } = run
  const r = src.rosters
  const counts: Record<string, number> = {}
  const warnings: string[] = []
  const id = (kind: string, mock: string) => detId(tenantId, `roster-${kind}`, mock)
  const at = (wall: string) => anchor.instant(wall)

  // ---- locations, supervisor grants, shift types and their targets ----
  const locIds = new Map<string, string>()
  for (const l of r.locations) {
    const lid = id("location", l.id)
    locIds.set(l.id, lid)
    await tx.insert(locations).values({
      id: lid, tenantId, name: l.name, address: l.address, lat: l.pin.lat, lng: l.pin.lng, zoneRadiusM: l.zoneRadiusM, openingHours: openingHoursOf(l.openingHours), contact: l.contact,
      swapApprovalDelegated: l.swapApprovalDelegated, createdAt: now, updatedAt: now,
    })
  }
  counts.locations = locIds.size
  for (const g of r.access.grants) await tx.insert(locationSupervisors).values({ tenantId, locationId: locIds.get(g.locationId)!, userId: userOfMock(g.personId), createdBy: actorId, createdAt: now })
  counts.supervisorGrants = r.access.grants.length

  const typeIds = new Map<string, string>()
  for (const t of r.templates) {
    const tid = id("shift-type", t.id)
    typeIds.set(t.id, tid)
    await tx.insert(shiftTypes).values({ id: tid, tenantId, locationId: locIds.get(t.locationId)!, name: t.name, startTime: t.start, endTime: t.end, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires, createdAt: now, updatedAt: now })
  }
  for (const t of r.targets) await tx.insert(shiftTypeTargets).values({ tenantId, shiftTypeId: typeIds.get(t.templateId)!, weekday: t.weekday, count: t.count })
  counts.shiftTypes = typeIds.size
  counts.shiftTargets = r.targets.length

  // ---- the rules the tenant chose (severity per rule, the averaging window) ----
  const rules = { severity: r.rules.severity, avgWeekReferenceWeeks: r.rules.avgWeekReferenceWeeks }
  await tx.insert(tenantSettings).values({ tenantId, key: RULES_SETTING, value: rules }).onConflictDoUpdate({ target: [tenantSettings.tenantId, tenantSettings.key], set: { value: rules } })

  // ---- people: home sites and qualifications (the one that expires soonest is the demo's expiry example) ----
  let quals = 0
  for (const w of r.workforce) {
    const uid = userOfMock(w.id)
    await tx.update(memberships).set({ homeLocationId: locIds.get(w.homeLocationId)! }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, uid)))
    for (const q of w.qualifications) {
      await tx.insert(memberQualifications).values({ id: id("qualification", `${w.id}:${q.type}`), tenantId, userId: uid, type: q.type, expiresOn: q.expires ? anchor.day(q.expires) : null, createdBy: actorId, createdAt: now, updatedAt: now })
      quals++
    }
  }
  counts.qualifications = quals

  // ---- weeks and shifts ----
  const weekIds = new Map<string, string>()
  for (const w of r.weeks) {
    const wid = id("week", w.id)
    weekIds.set(w.id, wid)
    const published = w.status === "published"
    await tx.insert(rosterWeeks).values({
      id: wid, tenantId, locationId: locIds.get(w.locationId)!, weekStart: anchor.day(w.weekStart), status: w.status, publishedAt: published && w.publishedAt ? at(w.publishedAt) : null,
      publishedBy: published && w.publishedBy ? userOfMock(w.publishedBy) : null, autoRepeatDays: w.autoRepeatDays, version: published ? 2 : 1, createdAt: now, updatedAt: now,
    })
  }
  counts.weeks = weekIds.size
  const shiftIds = new Map<string, string>()
  let open = 0
  for (const s of r.shifts) {
    const sid = id("shift", s.id)
    shiftIds.set(s.id, sid)
    const date = anchor.day(s.date)
    const t = shiftInstants(date, s.start, s.end, tz)
    if (!s.personId) open++
    await tx.insert(rosterShifts).values({
      id: sid, tenantId, weekId: weekIds.get(s.weekId)!, locationId: locIds.get(s.locationId)!, date, userId: s.personId ? userOfMock(s.personId) : null, shiftTypeId: typeIds.get(s.templateId)!,
      role: s.role, startTime: s.start, endTime: s.end, unpaidBreakMin: s.unpaidBreakMin, startAt: new Date(t.startAt), endAt: new Date(t.endAt), confirmedAt: s.confirmedAt ? at(s.confirmedAt) : null,
      version: 1, createdBy: actorId, createdAt: now, updatedAt: now,
    })
  }
  counts.shifts = shiftIds.size
  counts.openShifts = open

  // ---- history: the mock's lines in the service's action names, plus one publish line for every published week the mock has none for (id-only, never a name) ----
  const ACTION: Record<string, string> = { publish: "week_published", "edit-published": "shift_moved", "create-week": "week_created" }
  let lines = 0
  const hist = async (h: { weekId: string; locationId: string; shiftId: string | null; at: Date; by: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null }, key: string) => {
    await tx.insert(rosterHistory).values({
      id: id("history", key), tenantId, weekId: weekIds.get(h.weekId) ?? null, locationId: locIds.get(h.locationId)!, shiftId: h.shiftId ? (shiftIds.get(h.shiftId) ?? null) : null,
      action: h.action, actorId: h.by, reason: h.reason, before: h.before, after: h.after, createdAt: h.at,
    })
    lines++
  }
  for (const h of r.history) await hist({ ...h, weekId: h.weekId!, at: at(h.at), by: userOfMock(h.by), action: ACTION[h.action] ?? h.action }, h.id)
  for (const w of r.weeks) {
    if (w.status !== "published" || r.history.some((h) => h.weekId === w.id && h.action === "publish")) continue
    await hist({ weekId: w.id, locationId: w.locationId, shiftId: null, at: at(w.publishedAt!), by: userOfMock(w.publishedBy!), action: "week_published", before: { status: "draft", version: 1 }, after: { status: "published", version: 2 }, reason: null }, `publish-${w.id}`)
  }
  counts.history = lines

  // ---- a change request, claims and swaps (the mock's `open` is the service's `requested`) ----
  const status = (s: string) => (s === "open" ? "requested" : s)
  for (const q of r.requests) {
    await tx.insert(rosterChangeRequests).values({
      id: id("request", q.id), tenantId, shiftId: shiftIds.get(q.shiftId)!, shiftVersion: 1, requestedBy: userOfMock(q.by), patch: q.patch, reason: q.why, status: status(q.status),
      decidedBy: q.decidedBy ? userOfMock(q.decidedBy) : null, decidedAt: q.decidedAt ? at(q.decidedAt) : null, decisionNote: q.note, createdAt: at(q.at), updatedAt: at(q.decidedAt ?? q.at),
    })
  }
  counts.changeRequests = r.requests.length
  for (const c of r.claims) {
    await tx.insert(rosterExchanges).values({
      id: id("exchange", c.id), tenantId, kind: "claim", shiftId: shiftIds.get(c.shiftId)!, fromUserId: userOfMock(c.personId), toUserId: null, status: status(c.status), note: "",
      decidedBy: c.decidedBy ? userOfMock(c.decidedBy) : null, decidedAt: c.decidedAt ? at(c.decidedAt) : null, createdAt: at(c.at), updatedAt: at(c.decidedAt ?? c.at),
    })
  }
  for (const s of r.swaps) {
    await tx.insert(rosterExchanges).values({
      id: id("exchange", s.id), tenantId, kind: "swap", shiftId: shiftIds.get(s.shiftId)!, fromUserId: userOfMock(s.fromPersonId), toUserId: s.toPersonId ? userOfMock(s.toPersonId) : null, status: status(s.status),
      note: "", createdAt: at(s.at), updatedAt: at(s.at),
    })
  }
  counts.exchanges = r.claims.length + r.swaps.length

  // ---- leave and availability ----
  const LEAVE: Record<string, string> = { "Annual leave": "annual", "Sick leave": "sick" }
  for (const l of r.leave) {
    await tx.insert(leaveRequests).values({
      id: id("leave", l.id), tenantId, userId: userOfMock(l.personId), fromDate: anchor.day(l.from), toDate: anchor.day(l.to), kind: LEAVE[l.kind] ?? l.kind.toLowerCase(), status: l.status, note: "",
      decidedBy: l.decidedBy ? userOfMock(l.decidedBy) : null, decidedAt: l.decidedAt ? at(l.decidedAt) : null, createdAt: now, updatedAt: l.decidedAt ? at(l.decidedAt) : now,
    })
  }
  counts.leave = r.leave.length
  for (const a of r.availability) await tx.insert(rosterAvailability).values({ tenantId, userId: userOfMock(a.personId), weekday: a.weekday, fromTime: a.from, toTime: a.to })
  counts.availability = r.availability.length

  // ---- saved week layouts (a person who was rostered keeps their user id; the template stores no names) ----
  for (const t of r.weekTemplates) {
    const names = new Map(r.templates.map((x) => [x.id, x.name]))
    const shifts = t.shifts.map((s) => ({ day: s.day, personId: s.personId ? userOfMock(s.personId) : null, templateId: typeIds.get(s.templateId)!, role: s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin, typeName: names.get(s.templateId)! }))
    await tx.insert(rosterWeekTemplates).values({ id: id("week-template", t.id), tenantId, locationId: locIds.get(t.locationId)!, name: t.name, shifts, createdBy: actorId, createdAt: now, updatedAt: now })
  }
  counts.weekTemplates = r.weekTemplates.length

  // ---- demo personas: who can edit rosters (see the header) ----
  const grant = async (key: string, level: "office" | "supervisor") => {
    await tx.update(roles).set({ rosterLevel: level, access: sql`access || '{"roster":"write"}'::jsonb` }).where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
  }
  await grant("ops", "office")
  await grant("supervisor", "supervisor")
  return { counts, warnings }
}
