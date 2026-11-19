// The roster readers, taking any client that can GET (`ApiClient` in production, a fake in tests). `readers.ts` binds them to `apiServer()`.
// The API already cut every answer to what the caller may see (I14): these functions map and combine, they never filter by role or location, and they never run a rule check (R8: the rule engine
// lives on the API; the web only shows the `violations` it sends back).
import type { ApiClient } from "@/lib/api/client"
import {
  toAvailability, toChangeRequest, toCoverage, toExchange, toHistory, toLeave, toLocation, toMine, toPage, toRules, toShift, toShiftType, toTemplate, toWeeksPayload,
} from "./adapters"
import type {
  ApiChangeRequest, ApiLeave, Coverage, ExchangeBoard, ExchangeQuery, HistoryEntry, LeaveQueueData, LocationAdmin, MyRoster, Page, RosterLocation, RosterPayload, RulesView, WeekQuery, WeekTemplateSummary,
} from "./types"

type Getter = Pick<ApiClient, "get">
const defined = <T extends Record<string, string | undefined>>(q: T): Record<string, string> => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as Record<string, string>

/** The week view payload: the weeks, shifts, shift types and member names of the range, plus the caller's locations. */
export async function loadRosterData(api: Getter, q: WeekQuery = {}): Promise<RosterPayload> {
  const [weeks, locations] = await Promise.all([api.get("/v1/roster/weeks", { query: defined(q) }), api.get("/v1/locations")])
  return toWeeksPayload(weeks, locations.items)
}

export async function loadLocations(api: Getter, includeArchived = false): Promise<RosterLocation[]> {
  return (await api.get("/v1/locations", { query: { includeArchived: includeArchived ? "true" : "false" } })).items.map(toLocation)
}

/** One location with its shift types (archived ones too: rostered shifts keep their type) and the newest page of its change history. */
export async function loadLocationAdmin(api: Getter, id: string): Promise<LocationAdmin> {
  const path = { id }
  const [location, types, history] = await Promise.all([
    api.get("/v1/locations/{id}", { path }),
    api.get("/v1/locations/{id}/shift-types", { path, query: { includeArchived: "true" } }),
    api.get("/v1/locations/{id}/history", { path }),
  ])
  return { location: toLocation(location), shiftTypes: types.items.map(toShiftType), history: toPage<HistoryEntry>(history, toHistory) }
}

/** The signed-in person's own roster: published shifts in the range, weekly not-available windows and own leave. `me` is the person's user id (for the leave filter and the availability rows). */
export async function loadMyRoster(api: Getter, range: { from?: string; to?: string }, me: string): Promise<MyRoster> {
  const [mine, availability, leave] = await Promise.all([
    api.get("/v1/roster/mine", { query: defined(range) }),
    api.get("/v1/roster/availability"),
    api.get("/v1/leave", { query: { userId: me, limit: "200" } }),
  ])
  return toMine(mine, toAvailability(availability, me), leave.items.map(toLeave))
}

/** Leave waiting for a decision, newest first (the API cuts it to the people the caller may decide for). */
export async function loadLeaveQueue(api: Getter, cursor?: string): Promise<LeaveQueueData> {
  return toPage<ApiLeave>(await api.get("/v1/leave", { query: defined({ status: "requested", limit: "100", cursor }) }), toLeave)
}

/** Claims and swaps, plus the open shifts of PUBLISHED weeks in the range (a draft week's open shifts are not on offer). */
export async function loadExchange(api: Getter, q: ExchangeQuery = {}): Promise<ExchangeBoard> {
  const [ex, weeks] = await Promise.all([
    api.get("/v1/roster/exchanges", { query: defined({ status: q.status, shiftId: q.shiftId, cursor: q.cursor }) }),
    api.get("/v1/roster/weeks", { query: defined({ from: q.from, to: q.to }) }),
  ])
  const page = toPage(ex, toExchange)
  const published = new Set(weeks.weeks.filter((w) => w.status === "published").map((w) => w.id))
  return { ...page, openShifts: weeks.shifts.map(toShift).filter((s) => s.personId === null && published.has(s.weekId)) }
}

export async function loadChangeRequests(api: Getter, q: { status?: string; locationId?: string; cursor?: string } = {}): Promise<Page<ApiChangeRequest>> {
  return toPage(await api.get("/v1/roster/change-requests", { query: defined(q) }), toChangeRequest)
}

export async function loadWeekHistory(api: Getter, weekId: string, cursor?: string): Promise<Page<HistoryEntry>> {
  return toPage(await api.get("/v1/roster/weeks/{id}/history", { path: { id: weekId }, query: defined({ cursor }) }), toHistory)
}

export async function loadWeekTemplates(api: Getter, locationId?: string): Promise<WeekTemplateSummary[]> {
  return (await api.get("/v1/roster/week-templates", { query: defined({ locationId }) })).items.map(toTemplate)
}

/** The rule settings and the ETag they came with (a later PUT must send it back as If-Match). */
export async function loadRules(api: Getter): Promise<RulesView> {
  let etag: string | null = null
  const dto = await api.get("/v1/roster/rules", { onResponse: (res) => { etag = res.headers.get("etag") } })
  return toRules(dto, etag)
}

export async function loadCoverage(api: Getter, q: { from?: string; to?: string; locationId?: string }): Promise<Coverage> {
  return toCoverage(await api.get("/v1/roster/coverage", { query: defined(q) }))
}
