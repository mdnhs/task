import type { ReactNode } from "react"

import { gateOf } from "@/lib/api/problem"

import { AccessRestricted } from "./access-restricted"

/**
 * For a page that read the API and was refused: the full-page state for a 403 (module_not_entitled = "Not in your plan", other 403 = "Access restricted"),
 * or null when the failure is not a gate, so the page rethrows it to its error state. Usage: `try { ... } catch (e) { const v = apiFailureView(e, "Tasks"); if (v) return v; throw e }`.
 */
export function apiFailureView(e: unknown, moduleLabel: string): ReactNode | null {
  switch (gateOf(e)) {
    case "plan": return <AccessRestricted moduleLabel={moduleLabel} notInPlan />
    case "forbidden": return <AccessRestricted moduleLabel={moduleLabel} />
    default: return null
  }
}
