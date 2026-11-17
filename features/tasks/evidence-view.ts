// What the evidence UI may show and do, in ONE place (D8, D10), so no call site can pass a partial assignee list or count a file that is not clean.
import { canVerify, evidenceState } from "@/lib/task-evidence"
import type { Evidence, Task } from "./types"

/** An item that counts toward the rule: a file only once its scan says clean (an infected or still-scanning file does not), the rest always. A rejected item stays (it explains "rejected"). Same as the API's stateItems. */
export const isCounted = (e: Evidence): boolean => e.review === "rejected" || !e.fileId || e.fileStatus === "clean"
export const countable = (items: readonly Evidence[]): Evidence[] => items.filter(isCounted)
/** The task as the rule helpers must see it: only the counted evidence. */
export const ruleView = (t: Task): Task => ({ ...t, evidence: countable(t.evidence) })
export const evState = (t: Task) => evidenceState(t.evidenceRule, countable(t.evidence), t.status)

export type Viewer = { id: string; name: string; manager: boolean }

/**
 * May this viewer verify or reject the task's evidence? Nobody verifies their own work: the PRIMARY assignee and EVERY co-assignee are out (a manager who is a co-assignee too),
 * and so is the uploader of an item still waiting (matched by display name: the API keeps the uploader's id and is the authority, 403 self_verification). Always takes the whole task, so the
 * full assignee list is what is checked (B5 follow-up, D8). API keys are never a web viewer.
 */
export function canVerifyTask(t: Pick<Task, "evidenceRule" | "creator" | "assignee" | "assignees" | "evidence">, viewer: Viewer): boolean {
  if (!canVerify(t.evidenceRule, { id: viewer.id, manager: viewer.manager }, { creator: t.creator, assignee: t.assignee, assignees: t.assignees ?? [] })) return false
  return !t.evidence.some((e) => e.review === "pending" && e.by === viewer.name)
}
export const canVerifyItem = (e: Evidence, viewer: Viewer): boolean => e.by !== viewer.name

/** The short copy for a file the server refused or never cleared (never the server's text). An infected file is said clearly: it was NOT attached. */
export const fileRefusedCopy = (reason: "infected" | "slow" | "upload", name: string): string =>
  reason === "infected" ? `${name} failed the malware scan and was not attached` : reason === "slow" ? `${name} is still being scanned. Try again in a moment` : `${name} could not be uploaded`
