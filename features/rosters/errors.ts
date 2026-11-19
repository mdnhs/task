// How a refused roster write reaches the screen (B8 Task 19; B6 rulings I10, I22). Pure: no React, no Next, no server-only import, so server actions and client components share it.
// Every API answer maps to ONE state; the state decides the UI, the toast copy is the app's own (never the server's text). The table:
//   409 version_conflict (and 412)  -> conflict        refetch, toast "Changed by someone else."
//   403 roster_locked               -> locked          refetch, NO toast: the view turns read-only
//   422 reason_required             -> reason_required no toast: open the reason dialog
//   422 rule_blocked                -> rule_blocked    no toast: the conflicts panel, with the violations the API sent
//   402                             -> billing         no toast: the billing banner speaks
//   403 module_not_entitled         -> not_entitled    no toast: the "not in your plan" state
//   403 rule_blocked_office_required-> rule_blocked    (needsOffice): a supervisor publishing over a blocked rule sees the same conflicts panel, with the office hint
//   428 precondition_required       -> precondition_required  refetch, toast "Reload the page and try again."
//   403 mfa_required / 401 mfa_challenge -> mfa        toast "Enter your verification code."
//   429                             -> rate_limited    toast, nothing else
//   network failure                 -> network         toast "No connection. Your change was not saved."
//   anything else                   -> its generic kind (forbidden, not_found, session_expired, error) with the generic copy and "Ref <requestId>"
import { ApiError, classifyApiError, userMessage } from "@/lib/api/problem"
import type { RuleViolation } from "@/lib/roster-rules"
import { toViolation } from "./adapters"

export type RosterToast = { text: string; ref: string | null }
export type RosterError = { refetch: boolean; toast: RosterToast | null; code: string } & (
  | { state: "conflict" | "locked" | "reason_required" | "billing" | "not_entitled" | "forbidden" | "not_found" | "session_expired" | "precondition_required" | "mfa" | "rate_limited" | "network" | "error" }
  | { state: "rule_blocked"; violations: RuleViolation[]; /** The rule blocks and only an office role may go over it (403 rule_blocked_office_required). */ needsOffice: boolean }
)
/** A refusal worth trying again with the same input (a reason dialog stays open with its text): not one that makes the action moot (the week locked, the thing gone, not allowed, not in the plan). */
export const retryable = (e: RosterError): boolean => !["locked", "not_found", "forbidden", "not_entitled", "billing", "rule_blocked"].includes(e.state)

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
  if (api?.status === 422 && code === "rule_blocked") return { state: "rule_blocked", refetch: false, toast: null, code, violations: violationsOf(api), needsOffice: false }
  if (api?.status === 403 && code === "rule_blocked_office_required") return { state: "rule_blocked", refetch: false, toast: null, code, violations: violationsOf(api), needsOffice: true }
  if (api?.status === 428) return { state: "precondition_required", refetch: true, toast: { ...toast, text: "Reload the page and try again." }, code }
  if (kind === "mfa_challenge" || kind === "mfa_enrolment") return { state: "mfa", refetch: false, toast, code }
  if (kind === "rate_limited") return { state: "rate_limited", refetch: false, toast: { ...toast, text: "Too many changes at once. Wait a moment, then try again." }, code }
  if (kind === "network") return { state: "network", refetch: false, toast: { ...toast, text: "No connection. Your change was not saved." }, code }
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

/** A side list (leave queue, exchanges, people) that the API refuses for this caller (403: a role without that view; 404: out of reach) is simply empty; any other failure is the page's error. */
export async function orEmpty<T>(read: Promise<T>, empty: T): Promise<T> {
  try {
    return await read
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return empty
    throw e
  }
}
