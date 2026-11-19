"use server"

// Server actions for every roster write (B8 Task 19). Each one builds the API client for THIS request (`apiServer()`: the allow-listed cookies, the tenant header from the httpOnly od-tenant cookie, Origin),
// so a tenant or header a browser sends as an argument is never read (I5). The answer is mapped, never thrown: `{ ok: true, value }` or `{ ok: false, error }` where `error.state` says what the
// screen does (conflict, locked, reason_required, rule_blocked, billing, not_entitled, ...; ./features/rosters/errors.ts). The server's text is never shown. The page re-reads the week after
// every action (the API is the truth, I10), so none of these revalidate by themselves.
//
// Contracts the UI must keep (carried from the reviews): `deleteShift` always sends the shift's `version`; `repeatWeek` with `replace` always sends `targetVersions`; decide and publish and
// edits on a published week send `overrideReason` and `overrideRuleIds` together; the rule settings are saved with the ETag they were read with.
import type { Req } from "@/lib/api/client"
import { apiServer } from "@/lib/api/server"
import { requireMfaOk } from "@/lib/session"
import {
  loadQualifications, loadRosterData, loadWeekHistory, runRosterWrite, toQualifications, toApplied, toChangeRequest, toExchange, toLeave, toLocation, toRepeat, toShift, toShiftType, toViolations, toWeek, type RosterWriteResult,
} from "@/features/rosters"

type Paths = keyof import("@/lib/api/schema").paths
type BodyOf<T> = T extends { body: infer X } ? X : T extends { body?: infer X } ? X : never
type PostBody<P extends Paths> = BodyOf<Req<P, "post">>
type PutBody<P extends Paths> = BodyOf<Req<P, "put">>
type PatchBody<P extends Paths> = BodyOf<Req<P, "patch">>

/** The second factor is checked BEFORE the write (a redirect is thrown, not mapped: runRosterWrite never sees it); a refused API call is mapped, never thrown. */
const write = async <T>(fn: (api: Awaited<ReturnType<typeof apiServer>>) => Promise<T>): Promise<RosterWriteResult<T>> => {
  await requireMfaOk()
  return runRosterWrite(async () => fn(await apiServer()))
}

// ------------------------------------------------------------------ locations, shift types, people
export async function createLocation(body: PostBody<"/v1/locations">) {
  return write(async (api) => toLocation(await api.post("/v1/locations", { body })))
}
export async function updateLocation(id: string, body: PatchBody<"/v1/locations/{id}">) {
  return write(async (api) => toLocation(await api.patch("/v1/locations/{id}", { path: { id }, body })))
}
export async function archiveLocation(id: string) {
  return write(async (api) => toLocation(await api.post("/v1/locations/{id}/archive", { path: { id } })))
}
export async function setLocationSupervisors(id: string, userIds: string[]) {
  return write(async (api) => (await api.put("/v1/locations/{id}/supervisors", { path: { id }, body: { userIds } })).userIds)
}
export async function createShiftType(locationId: string, body: PostBody<"/v1/locations/{id}/shift-types">) {
  return write(async (api) => toShiftType(await api.post("/v1/locations/{id}/shift-types", { path: { id: locationId }, body })))
}
export async function updateShiftType(id: string, body: PatchBody<"/v1/shift-types/{id}">) {
  return write(async (api) => toShiftType(await api.patch("/v1/shift-types/{id}", { path: { id }, body })))
}
/** DELETE archives (never deletes) and answers 204: rostered shifts keep reading the type. */
export async function archiveShiftType(id: string) {
  return write(async (api) => {
    await api.delete("/v1/shift-types/{id}", { path: { id } })
    return null
  })
}
export async function setShiftTypeTargets(id: string, targets: { weekday: number; count: number }[]) {
  return write(async (api) => toShiftType(await api.put("/v1/shift-types/{id}/targets", { path: { id }, body: { targets } })))
}
export async function setOfficeLimit(userId: string, except: string[]) {
  return write(async (api) => (await api.put("/v1/roster/office-limits/{userId}", { path: { userId }, body: { except } })).except)
}
export async function setQualifications(userId: string, qualifications: { type: string; expiresOn?: string | null }[]) {
  return write(async (api) => toQualifications(await api.put("/v1/members/{userId}/qualifications", { path: { userId }, body: { qualifications } })))
}
/** One person's licences with the API's expiry state (a read after the MFA check, for the licence editor's person switch). */
export async function readQualifications(userId: string) {
  await requireMfaOk()
  return runRosterWrite(async () => loadQualifications(await apiServer(), userId))
}
/** The location as the API has it now: the "Changed by someone else" banner offers Keep mine (continue on this version) or Reload theirs. A read. */
export async function readLocation(id: string) {
  await requireMfaOk()
  return runRosterWrite(async () => toLocation(await (await apiServer()).get("/v1/locations/{id}", { path: { id } })))
}
export async function setHomeLocation(userId: string, locationId: string | null) {
  return write(async (api) => (await api.put("/v1/members/{userId}/home-location", { path: { userId }, body: { locationId } })).homeLocationId)
}

// ------------------------------------------------------------------ weeks and shifts
/** The week view as the API has it now (after a write or a refused one): the page reads again, the API is the truth (I10). A read, so it never changes anything. */
export async function reloadRoster(q: { locationId?: string; from?: string; to?: string; view?: "day" | "week" | "fortnight" | "month" }) {
  await requireMfaOk()
  return runRosterWrite(() => loadRosterData(q))
}
/** One page of a week's change history (a read, so "Load more" and a week switch never write anything). `cursor` is the one the previous page came with. */
export async function historyPage(weekId: string, cursor: string | null, limit?: number) {
  await requireMfaOk()
  return runRosterWrite(() => loadWeekHistory(weekId, cursor ?? undefined, limit))
}
export async function createWeek(body: PostBody<"/v1/roster/weeks">) {
  return write(async (api) => toWeek(await api.post("/v1/roster/weeks", { body })))
}
export async function addShifts(weekId: string, body: PostBody<"/v1/roster/weeks/{id}/shifts">) {
  return write(async (api) => {
    const r = await api.post("/v1/roster/weeks/{id}/shifts", { path: { id: weekId }, body })
    return { shifts: r.shifts.map(toShift), violations: toViolations(r.violations) }
  })
}
export async function patchShift(id: string, body: PatchBody<"/v1/roster/shifts/{id}">) {
  return write(async (api) => {
    const r = await api.patch("/v1/roster/shifts/{id}", { path: { id }, body })
    return { shift: toShift(r.shift), violations: toViolations(r.violations) }
  })
}
/** The `version` is required: a delete never goes out blind (a stale one is 409 version_conflict). */
export async function deleteShift(id: string, o: { version: number; reason?: string }) {
  return write(async (api) => {
    await api.delete("/v1/roster/shifts/{id}", { path: { id }, query: { version: String(o.version), ...(o.reason ? { reason: o.reason } : {}) } })
    return null
  })
}
export async function confirmShift(id: string) {
  return write(async (api) => toShift(await api.post("/v1/roster/shifts/{id}/confirm", { path: { id } })))
}
export async function publishWeek(id: string, body: PostBody<"/v1/roster/weeks/{id}/publish">) {
  return write(async (api) => {
    const r = await api.post("/v1/roster/weeks/{id}/publish", { path: { id }, body })
    return { week: toWeek(r.week), violations: toViolations(r.violations) }
  })
}
/** The server's rule check of the week as stored (the web never runs the rule engine). */
export async function checkWeek(id: string) {
  return write(async (api) => {
    const r = await api.post("/v1/roster/weeks/{id}/check", { path: { id } })
    return { violations: toViolations(r.violations), blocking: r.blocking }
  })
}
type RepeatBody = PostBody<"/v1/roster/weeks/{id}/repeat">
/** `replace` needs `targetVersions` for every existing draft target (the type refuses one without). */
export async function repeatWeek(id: string, body: Omit<RepeatBody, "replace" | "targetVersions"> & ({ replace?: false; targetVersions?: undefined } | { replace: true; targetVersions: Record<string, number> })) {
  return write(async (api) => toRepeat(await api.post("/v1/roster/weeks/{id}/repeat", { path: { id }, body: body as RepeatBody })))
}
export async function setAutoRepeat(id: string, days: number | null) {
  return write(async (api) => toWeek(await api.put("/v1/roster/weeks/{id}/auto-repeat", { path: { id }, body: { days } })))
}
export async function saveWeekTemplate(id: string, name: string) {
  return write(async (api) => (await api.post("/v1/roster/weeks/{id}/save-template", { path: { id }, body: { name } })).id)
}
export async function applyWeekTemplate(body: PostBody<"/v1/roster/week-templates/apply">) {
  return write(async (api) => toApplied(await api.post("/v1/roster/week-templates/apply", { body })))
}
export async function deleteWeekTemplate(id: string) {
  return write(async (api) => {
    await api.delete("/v1/roster/week-templates/{id}", { path: { id } })
    return null
  })
}

// ------------------------------------------------------------------ change requests, open shifts, swaps
export async function requestChange(shiftId: string, body: PostBody<"/v1/roster/shifts/{id}/change-requests">) {
  return write(async (api) => toChangeRequest(await api.post("/v1/roster/shifts/{id}/change-requests", { path: { id: shiftId }, body })))
}
export async function decideChange(id: string, body: PostBody<"/v1/roster/change-requests/{id}/decide">) {
  return write(async (api) => {
    const r = await api.post("/v1/roster/change-requests/{id}/decide", { path: { id }, body })
    return { request: toChangeRequest(r.request), shift: r.shift ? toShift(r.shift) : null, violations: toViolations(r.violations) }
  })
}
export async function claimShift(shiftId: string) {
  return write(async (api) => toExchange(await api.post("/v1/roster/shifts/{id}/claim", { path: { id: shiftId } })))
}
export async function proposeSwap(shiftId: string, body: PostBody<"/v1/roster/shifts/{id}/swap">) {
  return write(async (api) => toExchange(await api.post("/v1/roster/shifts/{id}/swap", { path: { id: shiftId }, body })))
}
export async function recommendExchange(id: string) {
  return write(async (api) => toExchange(await api.post("/v1/roster/exchanges/{id}/recommend", { path: { id } })))
}
export async function decideExchange(id: string, body: PostBody<"/v1/roster/exchanges/{id}/decide">) {
  return write(async (api) => {
    const r = await api.post("/v1/roster/exchanges/{id}/decide", { path: { id }, body })
    return { exchange: toExchange(r.exchange), shift: r.shift ? toShift(r.shift) : null, violations: toViolations(r.violations) }
  })
}
export async function declineExchange(id: string) {
  return write(async (api) => toExchange(await api.post("/v1/roster/exchanges/{id}/decline", { path: { id } })))
}
export async function cancelExchange(id: string) {
  return write(async (api) => toExchange(await api.post("/v1/roster/exchanges/{id}/cancel", { path: { id } })))
}

// ------------------------------------------------------------------ leave, availability, rules
export async function createLeave(body: PostBody<"/v1/leave">) {
  return write(async (api) => toLeave(await api.post("/v1/leave", { body })))
}
export async function cancelLeave(id: string) {
  return write(async (api) => toLeave(await api.post("/v1/leave/{id}/cancel", { path: { id } })))
}
export async function decideLeave(id: string, body: PostBody<"/v1/leave/{id}/decide">) {
  return write(async (api) => toLeave(await api.post("/v1/leave/{id}/decide", { path: { id }, body })))
}
export async function setAvailability(windows: { weekday: number; from: string; to: string }[]) {
  return write(async (api) => (await api.put("/v1/roster/availability", { body: { windows } })).windows.length)
}
/** `etag` is the one the settings were read with (`getRosterRules().etag`): a stale one is 412 (mapped to conflict), a missing one 428. */
export async function setRules(body: PutBody<"/v1/roster/rules">, etag: string) {
  return write(async (api) => {
    await api.put("/v1/roster/rules", { body, headers: { "if-match": etag } })
    return null
  })
}
