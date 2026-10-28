import type { Status } from "@/lib/types"

export type Stage = "applied" | "reviewed" | "contacted" | "interview" | "offer" | "starter" | "rejected"

export type Candidate = {
  id: string
  name: string
  role: string
  dept: string
  stage: Stage
  /** Personal data (FR-REC-03). The server drops it for roles without write access, so it never reaches their browser. */
  contact?: { email: string; phone: string }
  lastContact: string | null
  nextAction: string
  owner: string
  /** ISO date the application arrived. */
  applied: string
  history: { at: string; by: string; action: string; note?: string }[]
}

export const STAGE_ORDER: Stage[] = ["applied", "reviewed", "contacted", "interview", "offer", "starter", "rejected"]

export const STAGE: Record<Stage, Status> = {
  applied: { tone: "mute", label: "Applied" },
  reviewed: { tone: "info", label: "Reviewed" },
  contacted: { tone: "info", label: "Contacted" },
  interview: { tone: "warn", label: "Interview" },
  offer: { tone: "warn", label: "Offer" },
  starter: { tone: "ok", label: "New starter" },
  rejected: { tone: "bad", label: "Rejected" },
}

export type View = "pipeline" | "list"
export const RECRUITMENT_PAGE_SIZE = 10
