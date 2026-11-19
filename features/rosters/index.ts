// API-backed readers (B8 Tasks 19, 20): `read*` in readers.ts, `load*` here (the test/auth-static.test.ts taint matches reader names).
export {
  readRosterData as loadRosterData, readLocationAdminData as loadLocationAdminData, readMyRoster as loadMyRoster, readLeaveQueue as loadLeaveQueue, readExchange as loadExchange, readExchanges as loadExchanges, readLocations as loadLocations,
  readChangeRequests as loadChangeRequests, readWeekHistory as loadWeekHistory, readWeekTemplates as loadWeekTemplates, readRuleSettings as loadRuleSettings, readCoverage as loadCoverage, readRosterPeople as loadRosterPeople,
} from "./readers"
export { mapRosterError, orEmpty, runRosterWrite } from "./errors"
export { loadQualifications } from "./loaders"
export { toApplied, toChangeRequest, toExchange, toLeave, toLocation, toQualifications, toRepeat, toShift, toShiftType, toViolations, toWeek } from "./adapters"
export { historyWeekOf, violationLines, weekViewData } from "./view"
export { overrideFields, patchBody, addBody } from "./editing"
export { runEdit } from "./editor"
export { RostersView, type RosterPanels } from "./components/rosters-view"
export { LocationsView } from "./components/locations-view"
export { LocationFormPage } from "./components/location-form"
export { MyRosterView } from "./components/my-roster"
export { LocationFormSkeleton, MyRosterSkeleton, LocationsSkeleton, RostersSkeleton } from "./components/skeletons"
export type * from "./types"
export type { RosterViewData } from "./view"
