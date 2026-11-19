// Server side readers of the roster (B8 Task 19): the loaders of ./loaders bound to this request's `apiServer()` (cookies and X-Tenant from the httpOnly cookie, never from the browser).
// `read*` here, `load*` in the index: the brief's `getRosterData(query)` etc. Task 20 renames them to the `get*` names when it retires the mock readers (the names collide today, and test/auth-static.test.ts matches readers by name).
import { apiServer } from "@/lib/api/server"
import {
  loadChangeRequests, loadCoverage, loadExchange, loadExchanges, loadLeaveQueue, loadLocationAdmin, loadLocations, loadMyRoster, loadRosterData, loadRosterPeople, loadRules, loadWeekHistory, loadWeekTemplates,
} from "./loaders"
import type { ExchangeQuery, ExchangeStatus, WeekQuery } from "./types"

export const readRosterData = async (q: WeekQuery = {}) => loadRosterData(await apiServer(), q)
export const readLocations = async (includeArchived = false) => loadLocations(await apiServer(), includeArchived)
export const readLocationAdminData = async (id: string) => loadLocationAdmin(await apiServer(), id)
export const readMyRoster = async (range: { from?: string; to?: string }, me: string) => loadMyRoster(await apiServer(), range, me)
export const readLeaveQueue = async (cursor?: string) => loadLeaveQueue(await apiServer(), cursor)
export const readExchange = async (q: ExchangeQuery = {}) => loadExchange(await apiServer(), q)
export const readChangeRequests = async (q: { status?: string; locationId?: string; cursor?: string } = {}) => loadChangeRequests(await apiServer(), q)
export const readWeekHistory = async (weekId: string, cursor?: string, limit?: number) => loadWeekHistory(await apiServer(), weekId, cursor, limit)
export const readExchanges = async (q: { status?: ExchangeStatus; cursor?: string } = {}) => loadExchanges(await apiServer(), q)
export const readWeekTemplates = async (locationId?: string) => loadWeekTemplates(await apiServer(), locationId)
export const readRuleSettings = async () => loadRules(await apiServer())
export const readCoverage = async (q: { from?: string; to?: string; locationId?: string } = {}) => loadCoverage(await apiServer(), q)
export const readRosterPeople = async () => loadRosterPeople(await apiServer())
