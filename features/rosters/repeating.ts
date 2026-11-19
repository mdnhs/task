import { addDays } from "@/lib/shifts"
import type { RepeatConflict, RepeatCounts, WeekRoster } from "./types"

// Repeat a week into the next weeks, on the API (FR-RS-22/26, D10; B8 Task 21). Pure: which Mondays the repeat lands on, what is already there, the request body (a replace needs the version of every
// draft it replaces: the API refuses one without, 422 targets_version_required) and the counts the answer is shown with. The copy itself, the rule check of every copied shift and the
// "open shift" decision are the API's: a shift is kept, kept with a warning, or opened, never dropped (Review Focus 5).

export const MAX_WEEKS = 12

export type RepeatTarget = { monday: string; week: WeekRoster | null }
export type RepeatPlan = { targets: RepeatTarget[]; published: number; drafts: number }

/** The Mondays of the next `n` weeks after the source week (1..12), each with the week the caller has seen there, if any. */
export function repeatPlan(source: { locationId: string; weekStart: string }, n: number, weeks: WeekRoster[]): RepeatPlan {
  const count = Math.min(MAX_WEEKS, Math.max(1, Math.floor(n) || 1))
  const targets = Array.from({ length: count }, (_, i) => {
    const monday = addDays(source.weekStart, 7 * (i + 1))
    return { monday, week: weeks.find((w) => w.locationId === source.locationId && w.weekStart === monday) ?? null }
  })
  return { targets, published: targets.filter((t) => t.week?.status === "published").length, drafts: targets.filter((t) => t.week?.status === "draft").length }
}

/** A published week in the way stops the repeat for everybody; a draft needs "Replace". */
export const repeatBlocked = (plan: RepeatPlan, replace: boolean): boolean => plan.published > 0 || (plan.drafts > 0 && !replace)

/** POST /v1/roster/weeks/{id}/repeat. Without `replace`: the version of the source and the count. With it: the version of EVERY draft that will be replaced, by its Monday (never a guess). */
export function repeatBody(source: { version: number }, plan: RepeatPlan, replace: boolean) {
  if (!replace) return { version: source.version, weeks: plan.targets.length } as const
  const targetVersions: Record<string, number> = {}
  for (const t of plan.targets) if (t.week?.status === "draft") targetVersions[t.monday] = t.week.version
  return { version: source.version, weeks: plan.targets.length, replace: true, targetVersions } as const
}

/** What the answer says in numbers: kept (the person stayed), warned (kept with a warning line), opened (a rule stopped the person: an open shift). */
export function repeatSummary(counts: RepeatCounts, conflicts: RepeatConflict[]) {
  return { copied: counts.copied, kept: counts.kept, warned: counts.warned, opened: counts.opened, open: conflicts.filter((c) => c.open).length, info: conflicts.filter((c) => !c.open).length }
}
