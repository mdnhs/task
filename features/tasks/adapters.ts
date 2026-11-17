// Pure mappers between the tasks API's DTOs and the UI's types (B6 T6.6). A missing or mistyped REQUIRED field THROWS: a renamed field must not become a silent "" or 0
// (Review Focus 4). Ids and refs (I11): every write uses `id` (the uuid), the UI shows `ref`; the client never invents an id. Times (I12): the wall strings are for display,
// every comparison reads the instants (`dueAt`, `startAt`). The API's PATCH, reschedule and propose bodies take wall strings only (a "Z" instant is refused), so a date the
// user did NOT change is left OUT of a PATCH (the stored instant stays, which is what "send the instant back" is for: the repeated DST hour cannot shift it).
import type { Evidence, Project, Task, TaskStatus, TaskTemplate, TimelineEvent } from "./types"
import { STATUS_ORDER } from "./types"

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`tasks: ${k} must be ${want}`)
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k, "a string"))
const int = (r: Rec, k: string): number => (Number.isInteger(r[k]) ? (r[k] as number) : bad(k, "an integer"))
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k, "a boolean"))
const arr = (r: Rec, k: string): unknown[] => (Array.isArray(r[k]) ? (r[k] as unknown[]) : bad(k, "an array"))
const strs = (r: Rec, k: string): string[] => arr(r, k).map((v) => (typeof v === "string" ? v : bad(k, "an array of strings")))
const rec = (v: unknown, what: string): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : bad(what, "an object"))
const optStr = (r: Rec, k: string): string | undefined => (r[k] === undefined || r[k] === null ? undefined : str(r, k))
const optInt = (r: Rec, k: string): number | undefined => (r[k] === undefined || r[k] === null ? undefined : int(r, k))
const oneOf = <T extends string>(r: Rec, k: string, set: readonly T[]): T => (set.includes(r[k] as T) ? (r[k] as T) : bad(k, `one of ${set.join(", ")}`))
const when = <T>(v: T | undefined, k: string): Record<string, T> => (v === undefined ? {} : { [k]: v })

export type TaskCtxFE = {
  /** The people the caller can see (user id → display name). Anyone else reads as "Member". */
  nameOf?: (id: string) => string
}

// ---- timeline and notes ----

export function toTimeline(history: readonly unknown[]): TimelineEvent[] {
  return history.map((h) => {
    const r = rec(h, "history item")
    const changes = arr(r, "changes").map((c) => {
      const x = rec(c, "change")
      return { field: str(x, "field"), from: str(x, "from"), to: str(x, "to") }
    })
    const notified = strs(r, "notified")
    const updateId = optStr(r, "updateId")
    return { at: str(r, "at"), by: str(r, "by"), text: str(r, "text"), ...(changes.length ? { changes } : {}), ...(notified.length ? { notified } : {}), ...when(updateId, "updateId") }
  })
}

/** Comments (GET /v1/tasks/{id}/comments, newest first) as the task page's notes, oldest first. Mentions are user ids and stay out of the note text. */
export function toNotes(comments: readonly unknown[]): TimelineEvent[] {
  return comments
    .map((c) => {
      const r = rec(c, "comment")
      return { at: str(r, "at"), by: str(r, "author"), text: str(r, "body") }
    })
    .reverse()
}

// ---- evidence ----

export function toEvidence(dto: unknown): Evidence {
  const r = rec(dto, "evidence")
  const review = oneOf(r, "review", ["pending", "accepted", "rejected"] as const)
  const status = r.fileStatus === undefined ? undefined : oneOf(r, "fileStatus", ["pending", "clean", "infected", "deleted"] as const)
  const source = r.source === undefined ? undefined : oneOf(r, "source", ["camera", "upload"] as const)
  const size = r.size === undefined ? undefined : (typeof r.size === "number" ? r.size : bad("size", "a number"))
  return {
    id: str(r, "id"),
    kind: oneOf(r, "kind", ["photo", "image", "pdf", "office", "video", "checklist", "signature", "note", "drive"] as const),
    name: str(r, "name"),
    by: str(r, "by"),
    at: str(r, "at"),
    review,
    round: int(r, "round"),
    locked: bool(r, "locked"),
    ...when(optStr(r, "reason"), "reason"),
    ...when(source, "source"),
    ...when(optStr(r, "url"), "url"),
    ...when(size, "size"),
    ...when(optStr(r, "fileId"), "fileId"),
    ...when(status, "fileStatus"),
    ...when(optStr(r, "capturedAt"), "capturedAt"),
    ...when(optStr(r, "reviewedBy"), "reviewedBy"),
    ...when(optStr(r, "reviewedAt"), "reviewedAt"),
  }
}

// ---- the task ----

const RULE_MODES = ["none", "optional", "required"] as const
const REVIEWS = ["auto", "creator", "manager", "named"] as const

function toRule(v: unknown): Task["evidenceRule"] {
  const r = rec(v, "evidenceRule")
  return {
    mode: oneOf(r, "mode", RULE_MODES),
    types: strs(r, "types") as Task["evidenceRule"]["types"],
    min: int(r, "min"),
    instruction: str(r, "instruction"),
    review: oneOf(r, "review", REVIEWS),
    ...when(optStr(r, "reviewer"), "reviewer"),
  }
}

/**
 * A task DTO as the FE Task. `ctx.comments` are the task's comments (the DTO's own `notes` is empty): only the detail page loads them. A missing `parentRef` means no parent link
 * (the parent is out of scope, E15). `seriesId` stays an opaque string: the FE groups by it and never shows it.
 */
export function toTask(dto: unknown, ctx: { comments?: readonly unknown[] } = {}): Task {
  const r = rec(dto, "task")
  const status = oneOf(r, "status", STATUS_ORDER)
  const priority = int(r, "priority")
  if (priority < 1 || priority > 3) bad("priority", "1, 2 or 3")
  const proposal = r.proposal === undefined ? undefined : rec(r.proposal, "proposal")
  const overdue = r.overdue === undefined ? undefined : rec(r.overdue, "overdue")
  const repeat = r.repeat === undefined ? undefined : rec(r.repeat, "repeat")
  const voice = r.voiceNote === undefined || r.voiceNote === null ? undefined : rec(r.voiceNote, "voiceNote")
  const checklist = arr(r, "checklist").map((c) => {
    const x = rec(c, "checklist item")
    return { id: str(x, "id"), text: str(x, "text"), done: bool(x, "done") }
  })
  const subtasks = arr(r, "subtasks").map((c) => {
    const x = rec(c, "subtask")
    return { id: str(x, "id"), ref: str(x, "ref"), title: str(x, "title"), status: oneOf(x, "status", STATUS_ORDER) as TaskStatus }
  })
  const es = r.evidenceState
  if (es !== null && typeof es !== "string") bad("evidenceState", "a string or null")
  const parentId = r.parentId === null ? null : str(r, "parentId")
  return {
    id: str(r, "id"),
    ref: str(r, "ref"),
    version: int(r, "version"),
    title: str(r, "title"),
    description: str(r, "description"),
    dept: str(r, "dept"),
    teamId: r.teamId === null ? null : str(r, "teamId"),
    assignee: str(r, "assignee"),
    assignees: strs(r, "assignees"),
    creator: str(r, "creator"),
    priority: priority as Task["priority"],
    start: str(r, "start"),
    due: str(r, "due"),
    startAt: str(r, "startAt"),
    dueAt: str(r, "dueAt"),
    status,
    evidenceRule: toRule(r.evidenceRule),
    tags: strs(r, "tags"),
    ...when(optStr(r, "client"), "client"),
    ...when(optInt(r, "estimate"), "estimate"),
    ...when(optStr(r, "projectId"), "projectId"),
    ...when(optStr(r, "milestoneId"), "milestoneId"),
    ...when(optStr(r, "parentRef"), "parentRef"),
    parentId,
    checklist,
    subtasks,
    dependsOn: strs(r, "dependsOn"),
    dependsOnIds: strs(r, "dependsOnIds"),
    ...when(optStr(r, "archivedAt"), "archivedAt"),
    ...when(optStr(r, "archivedBy"), "archivedBy"),
    ...(proposal ? { proposal: { start: str(proposal, "start"), due: str(proposal, "due"), reason: str(proposal, "reason"), by: str(proposal, "by"), at: str(proposal, "at") } } : {}),
    round: int(r, "round"),
    ...(repeat
      ? {
          repeat: {
            freq: oneOf(repeat, "freq", ["daily", "weekdays", "weekly", "monthly", "per_shift"] as const),
            ...when(optStr(repeat, "patternId"), "patternId"),
            ...(Array.isArray(repeat.days) ? { days: repeat.days as number[] } : {}),
            ...when(optInt(repeat, "dayOfMonth"), "dayOfMonth"),
            ...when(optStr(repeat, "until"), "until"),
          },
        }
      : {}),
    ...when(optStr(r, "seriesId"), "seriesId"),
    ...when(optStr(r, "submittedAt"), "submittedAt"),
    ...when(optStr(r, "completedAt"), "completedAt"),
    notes: toNotes(ctx.comments ?? []),
    evidence: arr(r, "evidence").map(toEvidence),
    timeline: toTimeline(arr(r, "timeline")),
    ...(overdue ? { overdue: { reason: str(overdue, "reason"), nextAction: str(overdue, "nextAction"), owner: str(overdue, "owner"), revisedDue: str(overdue, "revisedDue") } } : {}),
    timeEntries: arr(r, "timeEntries").map((t) => {
      const x = rec(t, "time entry")
      return { id: str(x, "id"), at: str(x, "at"), by: str(x, "by"), minutes: typeof x.minutes === "number" ? x.minutes : bad("minutes", "a number"), note: str(x, "note"), source: str(x, "source") }
    }),
    evidenceState: es as string | null,
    // The note's metadata only: there is no URL (D21). Playing goes through the API, one logged play per click.
    ...(voice ? { voiceNote: { durationSec: typeof voice.durationSec === "number" ? voice.durationSec : bad("durationSec", "a number"), mime: str(voice, "mime"), recordedBy: str(voice, "recordedBy"), recordedAt: str(voice, "recordedAt") } } : {}),
  }
}

/** A card of the board, calendar or archive list (a thin task: no evidence, checklist or timeline). Only what the card shows is read, and the missing parts are empty. */
export function toCard(dto: unknown): Task {
  const r = rec(dto, "card")
  const status = oneOf(r, "status", STATUS_ORDER)
  const priority = int(r, "priority")
  if (priority < 1 || priority > 3) bad("priority", "1, 2 or 3")
  return {
    id: str(r, "id"),
    ref: str(r, "ref"),
    version: int(r, "version"),
    title: str(r, "title"),
    description: "",
    dept: str(r, "dept"),
    teamId: r.teamId === null ? null : str(r, "teamId"),
    assignee: str(r, "assignee"),
    assignees: strs(r, "assignees"),
    creator: str(r, "creator"),
    priority: priority as Task["priority"],
    start: str(r, "start"),
    due: str(r, "due"),
    startAt: str(r, "startAt"),
    dueAt: str(r, "dueAt"),
    status,
    evidenceRule: { mode: "none", types: [], min: 0, instruction: "", review: "manager" },
    tags: strs(r, "tags"),
    ...when(optStr(r, "projectId"), "projectId"),
    parentId: r.parentId === null ? null : str(r, "parentId"),
    ...when(optStr(r, "archivedAt"), "archivedAt"),
    ...when(optStr(r, "archivedBy"), "archivedBy"),
    notes: [],
    evidence: [],
    timeline: [],
  }
}

// ---- writes ----

export type TaskForm = {
  title: string
  description: string
  /** Department team id (the API takes the team's uuid, never the name). */
  teamId: string | null
  assignee: string
  others: string[]
  priority: 1 | 2 | 3
  /** Wall clock `YYYY-MM-DDTHH:mm[:ss]`, tenant local. */
  start: string
  due: string
  client?: string
  estimate?: number
  tags: string[]
  evidenceRule?: Task["evidenceRule"]
  projectId?: string
  milestoneId?: string
  templateId?: string
}

/** The POST /v1/tasks body. The repeat is a SECOND call (PUT /repeat, I13) and the voice note a third (PUT /voice-note): the API takes neither here. */
export function toTaskBody(f: TaskForm) {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    priority: f.priority,
    start: f.start,
    due: f.due,
    primary: f.assignee,
    others: f.others.filter((o) => o !== f.assignee),
    teamId: f.teamId,
    labels: f.tags,
    ...(f.estimate ? { estimateMin: f.estimate } : {}),
    ...(f.client?.trim() ? { client: f.client.trim() } : {}),
    ...(f.evidenceRule ? { evidenceRule: f.evidenceRule } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.projectId && f.milestoneId ? { milestoneId: f.milestoneId } : {}),
    ...(f.templateId ? { templateId: f.templateId } : {}),
  }
}

export type TaskPatch = {
  version: number
  title?: string
  description?: string
  priority?: 1 | 2 | 3
  labels?: string[]
  estimateMin?: number | null
  client?: string | null
  teamId?: string | null
  start?: string
  due?: string
  overduePlan?: { reason: string; nextAction: string; owner: string; revisedDue: string } | null
  projectId?: string | null
  milestoneId?: string | null
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The PATCH body: ONLY the fields that changed, plus the version of `prev` (D4). A date that did not change is not sent at all, so the instant the server holds
 * (`dueAt`) cannot move: sending the wall string back would re-resolve the repeated hour of a DST change to its FIRST instant (25 Oct 2026, 01:30 Dublin). A date the user
 * edited goes as the wall string. A field the user cleared goes as null where the API takes null.
 */
export function toPatch(prev: Task, next: Task): TaskPatch {
  if (prev.version === undefined) throw new Error("tasks: a write needs the task version")
  const p: TaskPatch = { version: prev.version }
  if (next.title !== prev.title) p.title = next.title.trim()
  if (next.description !== prev.description) p.description = next.description
  if (next.priority !== prev.priority) p.priority = next.priority
  if (!same(next.tags, prev.tags)) p.labels = next.tags
  if (next.estimate !== prev.estimate) p.estimateMin = next.estimate ?? null
  if ((next.client ?? "") !== (prev.client ?? "")) p.client = next.client?.trim() ? next.client.trim() : null
  if ((next.teamId ?? null) !== (prev.teamId ?? null)) p.teamId = next.teamId ?? null
  if (next.start !== prev.start) p.start = next.start
  if (next.due !== prev.due) p.due = next.due
  if (JSON.stringify(next.overdue ?? null) !== JSON.stringify(prev.overdue ?? null)) p.overduePlan = next.overdue ?? null
  if ((next.projectId ?? null) !== (prev.projectId ?? null)) p.projectId = next.projectId ?? null
  if ((next.milestoneId ?? null) !== (prev.milestoneId ?? null)) p.milestoneId = next.milestoneId ?? null
  return p
}

// ---- projects and templates ----

export function toProject(dto: unknown): Project {
  const r = rec(dto, "project")
  return {
    id: str(r, "id"),
    name: str(r, "name"),
    dept: str(r, "dept"),
    lead: r.leadId === null ? "" : str(r, "leadId"),
    description: str(r, "description"),
    due: r.due === null ? "" : str(r, "due"),
    version: int(r, "version"),
    progress: { done: int(rec(r.progress, "progress"), "done"), total: int(rec(r.progress, "progress"), "total"), pct: int(rec(r.progress, "progress"), "pct") },
    milestones: arr(r, "milestones").map((m) => {
      const x = rec(m, "milestone")
      return { id: str(x, "id"), name: str(x, "name"), due: str(x, "due"), state: oneOf(x, "state", ["done", "late", "open"] as const), done: int(x, "done"), total: int(x, "total") }
    }),
  }
}

export function toTemplate(dto: unknown): TaskTemplate & { version: number; teamId: string | null } {
  const r = rec(dto, "template")
  const priority = int(r, "priority")
  if (priority < 1 || priority > 3) bad("priority", "1, 2 or 3")
  return {
    id: str(r, "id"),
    version: int(r, "version"),
    name: str(r, "name"),
    title: str(r, "title"),
    description: str(r, "description"),
    dept: str(r, "dept"),
    teamId: r.teamId === null ? null : str(r, "teamId"),
    ...when(optStr(r, "assignee"), "assignee"),
    priority: priority as 1 | 2 | 3,
    tags: strs(r, "tags"),
    evidenceRule: toRule(r.evidenceRule),
    dueOffset: int(r, "dueOffset"),
    dueTime: str(r, "dueTime"),
  }
}
