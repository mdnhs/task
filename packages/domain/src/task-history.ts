import { epochToWall } from "./shifts"
import { STATUS, type FieldChange, type TaskStatus } from "./task-model"

// Field history of a task (FR-M1-12, AC-M1-04). The server stores RAW old and new values per field (UTC ISO for dates, ids for
// people and teams) and formats them per request in tenant time with the CURRENT names, so a name change or an erasure shows up
// in old history lines (names are never snapshotted). Pure and server-safe.

/** One stored change: the field's API name and its raw old and new value. */
export type RawChange = { field: string; from: unknown; to: unknown }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The fields (in `after`'s key order) whose value differs, with the raw old and new value. Arrays and objects compare deeply. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): RawChange[] {
  const out: RawChange[] = []
  for (const field of Object.keys(after)) if (!same(before[field], after[field])) out.push({ field, from: before[field] ?? null, to: after[field] ?? null })
  return out
}

export type FormatCtx = { tz: string; nameOf(userId: string): string; teamName(teamId: string): string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const PRIORITY = ["", "Low", "Medium", "High"]
const LABEL: Record<string, string> = {
  title: "Title", description: "Description", priority: "Priority", labels: "Labels", estimateMin: "Estimate", client: "Client", teamId: "Department",
  start: "Start", due: "Due", overduePlan: "Overdue plan", assignees: "Assignees", status: "Status",
}

/** "20 Nov 17:00" in `tz` for a UTC ISO instant. */
function when(iso: string, tz: string): string {
  const w = epochToWall(Date.parse(iso), tz) // YYYY-MM-DDTHH:MM
  return `${+w.slice(8, 10)} ${MONTHS[+w.slice(5, 7) - 1]} ${w.slice(11, 16)}`
}

function show(field: string, v: unknown, ctx: FormatCtx): string {
  if (v === null || v === undefined || v === "") return ""
  switch (field) {
    case "start":
    case "due":
      return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? when(v, ctx.tz) : String(v)
    case "assignees":
      return Array.isArray(v) ? v.map((id) => ctx.nameOf(String(id))).join(", ") : ""
    case "teamId":
      return ctx.teamName(String(v))
    case "status":
      return STATUS[v as TaskStatus]?.label ?? String(v)
    case "priority":
      return PRIORITY[Number(v)] ?? String(v)
    case "labels":
      return Array.isArray(v) ? v.join(", ") : ""
    case "estimateMin":
      return `${v} min`
    case "overduePlan":
      return typeof v === "object" ? "Plan set" : String(v)
    default:
      return String(v)
  }
}

/** The label of a stored field ("due" → "Due"). */
export const fieldLabel = (field: string): string => LABEL[field] ?? field

/** A stored change as the timeline shows it: a label and display strings (the FE `FieldChange`). */
export function formatChange(c: RawChange, ctx: FormatCtx): FieldChange {
  return { field: LABEL[c.field] ?? c.field, from: show(c.field, c.from, ctx), to: show(c.field, c.to, ctx) }
}
