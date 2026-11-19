export { getLeaveQueue, getLocationAdminData, getMyRoster, getRosterData, assignmentViolations, getHolidayDates, getMyExchange, getRosterExchange, getRosterHistory, getRosterRequests, getRosterRules, getWeekTemplates, weekViolations } from "./api"
// API-backed readers (B8 Task 19). The old mock readers above keep their names until Task 20 swaps the pages; these are the replacements, under their own names for now.
export {
  readRosterData as loadRosterData, readLocationAdminData as loadLocationAdminData, readMyRoster as loadMyRoster, readLeaveQueue as loadLeaveQueue, readExchange as loadExchange, readLocations as loadLocations,
  readChangeRequests as loadChangeRequests, readWeekHistory as loadWeekHistory, readWeekTemplates as loadWeekTemplates, readRuleSettings as loadRuleSettings, readCoverage as loadCoverage,
} from "./readers"
export { mapRosterError, runRosterWrite } from "./errors"
export { toApplied, toChangeRequest, toExchange, toLeave, toLocation, toRepeat, toShift, toShiftType, toViolations, toWeek } from "./adapters"
export { exchangeScopeKey, mergeById, mergeLocations, mineScopeKey, rosterScopeKey, withNewLocations } from "./scope"
export { rosterEdit, rosterViewData } from "./view"
export { RostersView } from "./components/rosters-view"
export { LocationsView } from "./components/locations-view"
export { LocationFormPage } from "./components/location-form"
export { MyRosterView } from "./components/my-roster"
export { LocationFormSkeleton, MyRosterSkeleton, LocationsSkeleton, RostersSkeleton } from "./components/skeletons"
// The client stores (./store) are imported by the feature's client components directly: this index is also used by server pages.
export type * from "./types"
export type { RosterViewData } from "./view"
