import { blocking, type RuleViolation } from "@/lib/roster-rules"
import { overrideFields } from "./editing"
import type { ApiChangeRequest, WeekAccess, WeekShift } from "./types"

// Publish, change requests and their decisions on the API (FR-RS-23/24/35/36/37; B8 Task 21). Pure: what the dialogs show and the request bodies they send. Whether a rule blocks, whether a
// supervisor may publish over it, whether a request is stale: all the API's. This file only reads the `violations` it sent back and the caller's `access.level` to decide what to OFFER.

export type PersonViolations = { personId: string; name: string; items: RuleViolation[] }

/** Group by person (not by shift): weekly rest and the 48h average are reported on one shift only (FR-RS-44). Blocks first inside a person; people with a block first. */
export function groupByPerson(violations: RuleViolation[], nameOf: (id: string) => string): PersonViolations[] {
  const map = new Map<string, RuleViolation[]>()
  for (const v of violations) map.set(v.personId, [...(map.get(v.personId) ?? []), v])
  const hard = (items: RuleViolation[]) => Number(items.some((i) => i.severity === "block"))
  return [...map]
    .map(([personId, items]) => ({ personId, name: nameOf(personId), items: [...items].sort((a, b) => Number(b.severity === "block") - Number(a.severity === "block")) }))
    .sort((a, b) => hard(b.items) - hard(a.items))
}

/**
 * What the publish dialog offers. A block stops a supervisor (`stopped`: the API answers 403 rule_blocked_office_required); the office goes over it with a reason (`needsReason`: 422 rule_blocked
 * without one). Warnings never stop anything. Nothing here decides: it picks the wording and the fields; the API is asked either way.
 */
export function publishPlan(violations: RuleViolation[], level: WeekAccess["level"]) {
  const blocks = blocking(violations).length
  return { blocks, warnings: violations.length - blocks, stopped: blocks > 0 && level !== "office", needsReason: blocks > 0 && level === "office" }
}

/** POST /v1/roster/weeks/{id}/publish: the week's `version` and, over a block, the reason with the rule ids it covers (both or neither). */
export function publishBody(week: { version: number }, reason: string, violations: RuleViolation[]) {
  return { version: week.version, ...overrideFields(reason, violations) }
}

// ----------------------------------------------------------------------------------------------------------------- change requests
export type ChangeForm = { start: string; end: string; personId: string | null; reason: string }
const FIELD: Record<string, string> = { date: "Day", start: "Start", end: "End", unpaidBreakMin: "Break", userId: "Person", shiftTypeId: "Shift", role: "Role" }

/** POST /v1/roster/shifts/{id}/change-requests: only the fields that differ, and why. `null` when nothing changed or the reason is blank (the dialog says which). */
export function requestChangeBody(shift: Pick<WeekShift, "start" | "end" | "personId">, f: ChangeForm): { patch: Record<string, string | null>; reason: string } | null {
  const patch: Record<string, string | null> = {}
  if (f.start !== shift.start) patch.start = f.start
  if (f.end !== shift.end) patch.end = f.end
  if (f.personId !== shift.personId) patch.userId = f.personId
  const reason = f.reason.trim()
  return Object.keys(patch).length && reason ? { patch, reason } : null
}

/** One short line per changed field: "Start 08:00 → 09:00". A shift that is no longer in the payload shows the new value only. */
export function patchLines(patch: ApiChangeRequest["patch"], shift: Pick<WeekShift, "start" | "end" | "date" | "personId" | "role" | "unpaidBreakMin"> | undefined, nameOf: (id: string | null) => string): string[] {
  const show = (k: string, v: unknown) => (k === "userId" ? nameOf((v as string | null) ?? null) : String(v))
  const now = (k: string): unknown => (!shift ? undefined : k === "userId" ? shift.personId : (shift as Record<string, unknown>)[k])
  return Object.entries(patch).map(([k, v]) => {
    const was = now(k)
    return `${FIELD[k] ?? k} ${was === undefined ? "" : `${show(k, was)} → `}${show(k, v)}`
  })
}

/** POST /v1/roster/change-requests/{id}/decide. An approval over a block carries the override: reason and rule ids together (`overrideReason`), or neither. */
export function decideBody(decision: "approve" | "reject", note: string, over?: { reason: string; violations: RuleViolation[] }) {
  const n = note.trim()
  return { decision, ...(n ? { note: n } : {}), ...(decision === "approve" && over ? overrideFields(over.reason, over.violations, "overrideReason") : {}) }
}

/** The API's sentence usually starts with the person's name: the name is shown once (bold) and the rest follows. A sentence without the name gets it in front. */
export function splitName(person: string, message: string): { name: string; rest: string } {
  return message.startsWith(person) ? { name: person, rest: message.slice(person.length) } : { name: person, rest: ` ${message}` }
}
