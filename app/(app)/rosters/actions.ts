"use server"

import { getUser } from "@/features/shell"
import { assignmentViolations, weekViolations } from "@/features/rosters"
import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getPeople } from "@/lib/people"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import type { RuleViolation } from "@/lib/roster-rules"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

/**
 * Rule check of one week for the publish dialog (D9). The caller's role and locations come from the session, never from the arguments:
 * the week id and the caller's own shifts of that week (made in this session, so a week or shift that exists only in the browser is
 * checked too) are taken. The shifts are validated on the server (visible locations, known people, dates in the week). It runs over every
 * location's shifts, so a clash at a site the caller can't see is found, and returns results for the caller's own shifts only, with a
 * generic message for causes elsewhere.
 */
export async function checkWeekRules(weekId: string, shifts?: unknown): Promise<RuleViolation[]> {
  if (typeof weekId !== "string") return []
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return []
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (!access.editDraft && !access.editPublished) return []
  return weekViolations(access, weekId, org.timezone, shifts)
}

/**
 * Rule check of an open shift taken or a swap, before it is approved: the assignments are hypothetical and run over every location's shifts,
 * so a clash at a site the caller can't see is found. The caller comes from the session; only the shift and person ids are taken.
 */
export async function checkAssignRules(assign: { shiftId: string; personId: string }[]): Promise<RuleViolation[]> {
  if (!Array.isArray(assign) || assign.some((x) => typeof x?.shiftId !== "string" || typeof x?.personId !== "string")) return []
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return []
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (!access.editDraft && !access.editPublished) return []
  return assignmentViolations(access, assign.map((x) => ({ shiftId: x.shiftId, personId: x.personId })), org.timezone)
}
