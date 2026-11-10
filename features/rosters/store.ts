import { createStore } from "@/lib/store"
import type { WeekTemplate } from "@/lib/roster-repeat"
import type { Availability, LeaveRequest } from "@/lib/roster-rules"
import type { LocationGrant } from "@/lib/roster-access"
import type { ChangeRequest, Claim, SwapRequest, HistoryEntry, Location, RosterShift, RosterWeek, ShiftTemplate, StaffingTarget } from "./types"

// Edits live here until reload (D13). Seeded from the server payload by the view.
export const weeksStore = createStore<RosterWeek[]>()
export const shiftsStore = createStore<RosterShift[]>()
export const templatesStore = createStore<ShiftTemplate[]>()
export const targetsStore = createStore<StaffingTarget[]>()
export const historyStore = createStore<HistoryEntry[]>()
export const locationsStore = createStore<Location[]>()
export const grantsStore = createStore<LocationGrant[]>()
export const requestsStore = createStore<ChangeRequest[]>()
export const weekTemplatesStore = createStore<WeekTemplate[]>()
// Staff self-service (Task 9): "Seen" confirmations (shift id to time), leave requests and not-available windows.
export const confirmStore = createStore<Record<string, { at: string; sig: string }>>()
export const leaveStore = createStore<LeaveRequest[]>()
export const availabilityStore = createStore<Availability[]>()
// Open shifts and swaps (Task 10): claims on open shifts and swap requests, seeded from the server (rosters/claims.json, swaps.json).
export const claimsStore = createStore<Claim[]>()
export const swapsStore = createStore<SwapRequest[]>()
