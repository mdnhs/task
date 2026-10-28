import { createStore } from "@/lib/store"
import type { PayrollIssue } from "./types"

export const payrollStore = createStore<PayrollIssue[]>()
