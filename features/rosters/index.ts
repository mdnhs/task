// The mock readers of My roster and the Locations admin stay until Tasks 22/23 swap those pages; the week view (/rosters) reads only the API below.
export { getLeaveQueue, getLocationAdminData, getMyRoster, getMyExchange } from "./api"
// API-backed readers (B8 Tasks 19, 20): `read*` in readers.ts, `load*` here (the test/auth-static.test.ts taint matches reader names).
export {
  readRosterData as loadRosterData, readLocationAdminData as loadLocationAdminData, readMyRoster as loadMyRoster, readLeaveQueue as loadLeaveQueue, readExchange as loadExchange, readExchanges as loadExchanges, readLocations as loadLocations,
  readChangeRequests as loadChangeRequests, readWeekHistory as loadWeekHistory, readWeekTemplates as loadWeekTemplates, readRuleSettings as loadRuleSettings, readCoverage as loadCoverage,
} from "./readers"
export { mapRosterError, runRosterWrite } from "./errors"
export { toApplied, toChangeRequest, toExchange, toLeave, toLocation, toRepeat, toShift, toShiftType, toViolations, toWeek } from "./adapters"
export { exchangeScopeKey, mergeById, mergeLocations, mineScopeKey, rosterScopeKey, withNewLocations } from "./scope"
export { historyWeekOf, violationLines, weekViewData } from "./view"
export { overrideFields, patchBody, addBody } from "./editing"
export { runEdit } from "./editor"
export { RostersView, type RosterPanels } from "./components/rosters-view"
export { LocationsView } from "./components/locations-view"
export { LocationFormPage } from "./components/location-form"
export { MyRosterView } from "./components/my-roster"
export { LocationFormSkeleton, MyRosterSkeleton, LocationsSkeleton, RostersSkeleton } from "./components/skeletons"
// The client stores (./store) are imported by the feature's client components directly: this index is also used by server pages.
export type * from "./types"
export type { RosterViewData } from "./view"
