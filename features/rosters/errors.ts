// How a refused roster write reaches the screen (B8 Task 19; B6 rulings I10, I22). Pure: no React, no Next, no server-only import, so server actions and client components share it.
// Every API answer maps to ONE state; the state decides the UI, the toast copy is the app's own (never the server's text). The table:
//   409 version_conflict (and 412)  -> conflict        refetch, toast "Changed by someone else."
//   403 roster_locked               -> locked          refetch, NO toast: the view turns read-only
//   422 reason_required             -> reason_required no toast: open the reason dialog
//   422 rule_blocked                -> rule_blocked    no toast: the conflicts panel, with the violations the API sent
//   402                             -> billing         no toast: the billing banner speaks
//   403 module_not_entitled         -> not_entitled    no toast: the "not in your plan" state
//   anything else                   -> its generic kind (forbidden, not_found, session_expired, error) with the generic copy and "Ref <requestId>"
import { ApiError, classifyApiError, userMessage } from "@/lib/api/problem"
import type { RuleViolation } from "@/lib/roster-rules"
import { toViolation } from "./adapters"

export type RosterToast = { text: string; ref: string | null }
export type RosterError = { refetch: boolean; toast: RosterToast | null; code: string } & (
  | { state: "conflict" | "locked" | "reason_required" | "billing" | "not_entitled" | "forbidden" | "not_found" | "session_expired" | "error" }
  | { state: "rule_blocked"; violations: RuleViolation[] }
)
export type RosterWriteResult<T> = { ok: true; value: T } | { ok: false; error: RosterError }

/** The violations of a `rule_blocked` answer; one that does not parse is dropped, so the panel never shows a half-made line. */
function violationsOf(e: ApiError): RuleViolation[] {
  const raw = e.extra.violations
  if (!Array.isArray(raw)) return []
  const out: RuleViolation[] = []
  for (const v of raw) {
    try {
      out.push(toViolation(v))
    } catch {
      /* skipped */
    }
  }
  return out
}

export function mapRosterError(e: unknown): RosterError {
  const { kind, code } = classifyApiError(e)
  const toast = userMessage(e)
  const api = e instanceof ApiError ? e : null
  if (kind === "version_conflict") return { state: "conflict", refetch: true, toast: { ...toast, text: "Changed by someone else." }, code }
  if (api?.status === 403 && code === "roster_locked") return { state: "locked", refetch: true, toast: null, code }
  if (api?.status === 422 && code === "reason_required") return { state: "reason_required", refetch: false, toast: null, code }
  if (api?.status === 422 && code === "rule_blocked") return { state: "rule_blocked", refetch: false, toast: null, code, violations: violationsOf(api) }
  if (kind === "billing_required") return { state: "billing", refetch: false, toast: null, code }
  if (kind === "module_not_entitled") return { state: "not_entitled", refetch: false, toast: null, code }
  if (kind === "forbidden") return { state: "forbidden", refetch: false, toast, code }
  if (kind === "not_found") return { state: "not_found", refetch: true, toast, code }
  if (kind === "session_expired" || kind === "unauthenticated") return { state: "session_expired", refetch: false, toast, code }
  return { state: "error", refetch: false, toast, code }
}

/** Runs one write. A 409 `retry` (the API was busy with the same record) is tried once more; any other answer is final and mapped. Never throws. */
export async function runRosterWrite<T>(request: () => Promise<T>): Promise<RosterWriteResult<T>> {
  try {
    try {
      return { ok: true, value: await request() }
    } catch (first) {
      if (classifyApiError(first).kind !== "retry") throw first
      return { ok: true, value: await request() }
    }
  } catch (e) {
    return { ok: false, error: mapRosterError(e) }
  }
}
