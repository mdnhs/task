import { createStore } from "@/lib/store"
import type { ShiftState } from "@/lib/shifts"

// Client store for the shift model (patterns, assignments, reporting lines, reporting settings). Shared so the /shifts page
// and the end-of-shift report (Phase 1 step 2) see the same in-memory edits. Seeded from lib/shifts-data.ts via props;
// `scope` (tenant + role) reseeds it when the session changes. Edit with the pure helpers in lib/shifts.ts.
export const shiftsStore = createStore<ShiftState>()

export function useShifts(seed: ShiftState, scope: string) {
  return shiftsStore.useStore(seed, scope)
}
