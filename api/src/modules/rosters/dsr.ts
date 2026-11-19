import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import {
  leaveRequests, locationSupervisors, memberQualifications, memberships, qualificationExpiryNotices, rosterAvailability, rosterChangeRequests, rosterExchanges, rosterHistory, rosterOfficeLimits,
  rosterShifts, rosterWeekTemplates, rosterWeeks,
} from "../../db/schema"
import { expireFile } from "../files"
import type { DsrHandler } from "../gdpr/registry"

/**
 * What an erased person's id becomes inside a saved week layout: one constant for everybody (never an id, never a hash). Nobody is a member under it, so applying the layout makes an OPEN shift and
 * a conflict `left` ("Left before <date>"), exactly like a person who left (repeat.ts `eligibilityOf`).
 */
export const ERASED_PERSON = "erased"
/** The actor of the history line an erasure writes (a system line: nobody to blame, nobody named). */
export const ERASURE_ACTOR = "system:dsr-erasure"
const ERASED_TEXT = "[erased]"

/**
 * Data-subject requests for rosters (FR-M0-18, B8 Task 18).
 *
 * Export: the person's OWN roster data of this tenant: their shifts, leave, availability, qualifications (with the proof file id), home site, supervisor grants and office limits, the change
 * requests they made, the exchanges they are in (claims and swaps; the other person only as an id, and the shift and the note only when the subject started the exchange), the saved layouts that name them (a count) and the history
 * lines they authored. Nobody else's shift, leave or qualification is in it.
 *
 * Erase (runs BEFORE the membership is removed, in the same tx; idempotent): the id is scrubbed from every saved week layout (see `ERASED_PERSON`); every shift of theirs becomes an open one in the
 * same step (not by the membership delete's silent SET NULL), and for every PUBLISHED week that had one a single history line (`member_erased_shifts_opened`, shift ids and a count, never the person)
 * says so; leave, availability, qualifications (their proof files expire), home site, grants, limits, their change requests and the exchanges they started are deleted, the exchanges that named them as the
 * colleague lose that link and the requester's note; the free text of the history lines they authored becomes "[erased]". History lines keep ids only (R8-13). There is no WhatsApp staging table in
 * this version, so no phone number is held by rosters. No roster lock here: the erase job already holds the subject's membership row, and a roster write holds the roster lock and then SHARES that
 * row, so taking the roster lock now could deadlock; the shift and week rows are locked in id order instead, as every roster write does.
 */
export const rostersDsrHandler: DsrHandler = {
  async export(tx, tenantId, userId) {
    const shifts = await tx
      .select({ s: rosterShifts, weekStatus: rosterWeeks.status })
      .from(rosterShifts)
      .innerJoin(rosterWeeks, and(eq(rosterWeeks.tenantId, rosterShifts.tenantId), eq(rosterWeeks.id, rosterShifts.weekId)))
      .where(and(eq(rosterShifts.tenantId, tenantId), eq(rosterShifts.userId, userId)))
      .orderBy(asc(rosterShifts.date), asc(rosterShifts.startAt), asc(rosterShifts.id))
    const leave = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.userId, userId))).orderBy(asc(leaveRequests.fromDate), asc(leaveRequests.id))
    const availability = await tx.select().from(rosterAvailability).where(and(eq(rosterAvailability.tenantId, tenantId), eq(rosterAvailability.userId, userId))).orderBy(asc(rosterAvailability.weekday), asc(rosterAvailability.fromTime))
    const quals = await tx.select().from(memberQualifications).where(and(eq(memberQualifications.tenantId, tenantId), eq(memberQualifications.userId, userId))).orderBy(asc(memberQualifications.type))
    const [member] = await tx.select({ home: memberships.homeLocationId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    const grants = await tx.select({ id: locationSupervisors.locationId }).from(locationSupervisors).where(and(eq(locationSupervisors.tenantId, tenantId), eq(locationSupervisors.userId, userId))).orderBy(asc(locationSupervisors.locationId))
    const limits = await tx.select({ id: rosterOfficeLimits.locationId }).from(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, tenantId), eq(rosterOfficeLimits.userId, userId))).orderBy(asc(rosterOfficeLimits.locationId))
    const requests = await tx.select().from(rosterChangeRequests).where(and(eq(rosterChangeRequests.tenantId, tenantId), eq(rosterChangeRequests.requestedBy, userId))).orderBy(asc(rosterChangeRequests.createdAt), asc(rosterChangeRequests.id))
    const exchanges = await tx
      .select()
      .from(rosterExchanges)
      .where(and(eq(rosterExchanges.tenantId, tenantId), or(eq(rosterExchanges.fromUserId, userId), eq(rosterExchanges.toUserId, userId))))
      .orderBy(asc(rosterExchanges.createdAt), asc(rosterExchanges.id))
    const layouts = await tx
      .select({ id: rosterWeekTemplates.id, locationId: rosterWeekTemplates.locationId, name: rosterWeekTemplates.name, shifts: rosterWeekTemplates.shifts })
      .from(rosterWeekTemplates)
      .where(and(eq(rosterWeekTemplates.tenantId, tenantId), sql`${rosterWeekTemplates.shifts} @> ${JSON.stringify([{ personId: userId }])}::jsonb`))
      .orderBy(asc(rosterWeekTemplates.id))
    const history = await tx.select().from(rosterHistory).where(and(eq(rosterHistory.tenantId, tenantId), eq(rosterHistory.actorId, userId))).orderBy(asc(rosterHistory.createdAt), asc(rosterHistory.id))
    const iso = (d: Date | null) => d?.toISOString() ?? null
    return {
      homeLocationId: member?.home ?? null,
      shifts: shifts.map(({ s, weekStatus }) => ({
        id: s.id, weekId: s.weekId, locationId: s.locationId, date: s.date, start: s.startTime, end: s.endTime, role: s.role, unpaidBreakMin: s.unpaidBreakMin, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
        confirmedAt: iso(s.confirmedAt), published: weekStatus === "published",
      })),
      leave: leave.map((l) => ({ id: l.id, from: l.fromDate, to: l.toDate, kind: l.kind, status: l.status, note: l.note, decidedBy: l.decidedBy, decidedAt: iso(l.decidedAt), decisionNote: l.decisionNote, createdAt: l.createdAt.toISOString() })),
      availability: availability.map((a) => ({ weekday: a.weekday, from: a.fromTime, to: a.toTime })),
      qualifications: quals.map((x) => ({ id: x.id, type: x.type, expiresOn: x.expiresOn, proofFileId: x.fileId })),
      supervisorOf: grants.map((g) => g.id),
      officeLimits: limits.map((l) => l.id),
      changeRequests: requests.map((r) => ({ id: r.id, shiftId: r.shiftId, patch: r.patch, reason: r.reason, status: r.status, decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt), decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString() })),
      exchanges: exchanges.map((e) => ({
        id: e.id, kind: e.kind, shiftId: e.fromUserId === userId ? e.shiftId : null, role: e.fromUserId === userId ? "requester" : "colleague", otherUserId: e.fromUserId === userId ? e.toUserId : e.fromUserId, status: e.status,
        note: e.fromUserId === userId ? e.note : null, decidedBy: e.decidedBy, decidedAt: iso(e.decidedAt), createdAt: e.createdAt.toISOString(),
      })),
      layoutsNamingYou: layouts.map((t) => ({ id: t.id, locationId: t.locationId, name: t.name, shifts: (t.shifts as { personId?: unknown }[]).filter((s) => s.personId === userId).length })),
      historyAuthored: history.map((h) => ({ id: h.id, weekId: h.weekId, locationId: h.locationId, shiftId: h.shiftId, action: h.action, reason: h.reason, createdAt: h.createdAt.toISOString() })),
    }
  },

  async erase(tx, tenantId, userId, now, enqueue) {
    // 1. saved week layouts: the id leaves the JSON (an erased person applies as an open shift flagged `left`)
    const layouts = await tx
      .select({ id: rosterWeekTemplates.id, shifts: rosterWeekTemplates.shifts })
      .from(rosterWeekTemplates)
      .where(and(eq(rosterWeekTemplates.tenantId, tenantId), sql`${rosterWeekTemplates.shifts} @> ${JSON.stringify([{ personId: userId }])}::jsonb`))
      .orderBy(asc(rosterWeekTemplates.id))
      .for("update")
    for (const t of layouts) {
      const shifts = (t.shifts as { personId?: unknown }[]).map((s) => (s.personId === userId ? { ...s, personId: ERASED_PERSON } : s))
      await tx.update(rosterWeekTemplates).set({ shifts, updatedAt: now }).where(and(eq(rosterWeekTemplates.tenantId, tenantId), eq(rosterWeekTemplates.id, t.id)))
    }

    // 2. their shifts become open shifts, openly: one history line per published week that had one
    const mine = await tx
      .select({ id: rosterShifts.id, weekId: rosterShifts.weekId, locationId: rosterShifts.locationId })
      .from(rosterShifts)
      .where(and(eq(rosterShifts.tenantId, tenantId), eq(rosterShifts.userId, userId)))
      .orderBy(asc(rosterShifts.id))
      .for("update")
    if (mine.length > 0) {
      const weekIds = [...new Set(mine.map((s) => s.weekId))].sort()
      const weeks = await tx.select().from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, tenantId), inArray(rosterWeeks.id, weekIds))).orderBy(asc(rosterWeeks.id)).for("update")
      await tx
        .update(rosterShifts)
        .set({ userId: null, confirmedAt: null, version: sql`${rosterShifts.version} + 1`, updatedAt: now })
        .where(and(eq(rosterShifts.tenantId, tenantId), inArray(rosterShifts.id, mine.map((s) => s.id))))
      for (const w of weeks) {
        if (w.status !== "published") continue // a draft tells nobody
        const ids = mine.filter((s) => s.weekId === w.id).map((s) => s.id)
        await tx.update(rosterWeeks).set({ version: sql`${rosterWeeks.version} + 1`, updatedAt: now }).where(and(eq(rosterWeeks.tenantId, tenantId), eq(rosterWeeks.id, w.id)))
        await tx.insert(rosterHistory).values({
          tenantId, weekId: w.id, locationId: w.locationId, shiftId: null, action: "member_erased_shifts_opened", actorId: ERASURE_ACTOR, reason: null,
          before: { shiftIds: ids, assigned: ids.length }, after: { shiftIds: ids, open: ids.length }, createdAt: now,
        })
      }
    }

    // 3. everything that is only theirs
    const proofs = await tx.select({ fileId: memberQualifications.fileId }).from(memberQualifications).where(and(eq(memberQualifications.tenantId, tenantId), eq(memberQualifications.userId, userId))).orderBy(asc(memberQualifications.id))
    await tx.delete(leaveRequests).where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.userId, userId)))
    await tx.delete(rosterAvailability).where(and(eq(rosterAvailability.tenantId, tenantId), eq(rosterAvailability.userId, userId)))
    await tx.delete(memberQualifications).where(and(eq(memberQualifications.tenantId, tenantId), eq(memberQualifications.userId, userId)))
    await tx.delete(qualificationExpiryNotices).where(and(eq(qualificationExpiryNotices.tenantId, tenantId), eq(qualificationExpiryNotices.userId, userId)))
    for (const p of proofs) if (p.fileId) await expireFile(tx, tenantId, p.fileId, enqueue ?? (() => {})) // the proof of a licence is theirs: its object goes with it
    await tx.update(memberships).set({ homeLocationId: null }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    await tx.delete(locationSupervisors).where(and(eq(locationSupervisors.tenantId, tenantId), eq(locationSupervisors.userId, userId)))
    await tx.delete(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, tenantId), eq(rosterOfficeLimits.userId, userId)))
    await tx.delete(rosterChangeRequests).where(and(eq(rosterChangeRequests.tenantId, tenantId), eq(rosterChangeRequests.requestedBy, userId)))
    await tx.delete(rosterExchanges).where(and(eq(rosterExchanges.tenantId, tenantId), eq(rosterExchanges.fromUserId, userId)))
    await tx.update(rosterExchanges).set({ toUserId: null, note: "" }).where(and(eq(rosterExchanges.tenantId, tenantId), eq(rosterExchanges.toUserId, userId)))

    // 4. the free text of the history lines they wrote (ids, actions and times stay)
    await tx.update(rosterHistory).set({ reason: ERASED_TEXT }).where(and(eq(rosterHistory.tenantId, tenantId), eq(rosterHistory.actorId, userId), sql`${rosterHistory.reason} is not null and ${rosterHistory.reason} <> ${ERASED_TEXT}`))
  },
}
