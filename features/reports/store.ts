import { createStore } from "@/lib/store"
import type { ShiftReport } from "./types"

// In-memory shift reports (edits, submits and reviews survive client navigation, reset on reload).
export const reportsStore = createStore<ShiftReport[]>()
