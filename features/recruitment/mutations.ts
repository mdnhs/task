import { STAGE, STAGE_ORDER } from "./types"
import type { Candidate, Stage } from "./types"

/** Moves a candidate to a stage and appends the change to its history. No-op when the stage is unchanged. */
export function changeStage(c: Candidate, stage: Stage, by: string, at: string): Candidate {
  if (c.stage === stage) return c
  return {
    ...c,
    stage,
    lastContact: stage === "applied" ? c.lastContact : at,
    history: [...c.history, { at, by, action: `Moved to ${STAGE[stage].label}`, note: `From ${STAGE[c.stage].label}` }],
  }
}

export function newCandidate(
  input: { name: string; role: string; dept: string; owner: string; email: string; phone: string; nextAction: string },
  id: string,
  by: string,
  at: string,
): Candidate {
  return {
    id,
    name: input.name.trim(),
    role: input.role.trim(),
    dept: input.dept,
    stage: "applied",
    contact: { email: input.email.trim(), phone: input.phone.trim() },
    lastContact: null,
    nextAction: input.nextAction.trim() || "Review application",
    owner: input.owner,
    applied: at.slice(0, 10),
    history: [{ at, by, action: "Candidate added" }],
  }
}

export const nextId = (all: Candidate[]) => `CND-${all.reduce((m, c) => Math.max(m, parseInt(c.id.replace(/\D/g, ""), 10) || 0), 2000) + 1}`

const AFTER = (from: Stage) => STAGE_ORDER.slice(STAGE_ORDER.indexOf(from), STAGE_ORDER.indexOf("starter") + 1)

/** The five counts of the daily report (SRS §3.9, FR-REC-01), derived from where each candidate is in the pipeline. */
export function recruitmentCounts(list: Candidate[]) {
  const n = (f: (c: Candidate) => boolean) => list.filter(f).length
  return {
    reviewed: n((c) => c.stage !== "applied"),
    contacted: n((c) => AFTER("contacted").includes(c.stage)),
    interviews: n((c) => AFTER("interview").includes(c.stage)),
    starters: n((c) => c.stage === "starter"),
    outstanding: n((c) => c.stage !== "starter" && c.stage !== "rejected"),
  }
}

export function byStage(list: Candidate[]): Record<Stage, Candidate[]> {
  const out = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as Candidate[]])) as Record<Stage, Candidate[]>
  for (const c of list) out[c.stage].push(c)
  return out
}

/**
 * Drag-and-drop move. A different stage goes through `changeStage` (history entry); the card lands before `overId`, or at the
 * end when dropped on the column itself. Same stage only reorders. Order within a stage is the order in the list.
 */
export function moveCandidate(list: Candidate[], id: string, stage: Stage, overId: string | null, by: string, at: string): Candidate[] {
  const from = list.findIndex((c) => c.id === id)
  if (from < 0) return list
  const moved = changeStage(list[from], stage, by, at)
  if (overId === id) return moved === list[from] ? list : list.map((c) => (c.id === id ? moved : c))
  const rest = list.filter((c) => c.id !== id)
  const over = overId ? list.findIndex((c) => c.id === overId) : -1
  let to = rest.length
  if (over >= 0) to = rest.findIndex((c) => c.id === overId) + (over > from && moved.stage === list[from].stage ? 1 : 0)
  rest.splice(to, 0, moved)
  return rest
}
