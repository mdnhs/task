import type { Status } from "@/lib/types"

export type DocStatus = "valid" | "expiring" | "expired" | "missing" | "unverified"

export type EmployeeDoc = {
  id: string
  type: string
  staff: string
  dept: string
  /** ISO date; null when the document has not arrived (status "missing"). */
  received: string | null
  expiry: string | null
  status: DocStatus
  /** Secure-storage reference; null when there is no file. */
  storageRef: string | null
  confirmedBy: string | null
  history: { at: string; by: string; action: string }[]
}

export type ClientDocStatus = "complete" | "incomplete" | "review"

export type ClientFile = {
  id: string
  client: string
  site: string
  dept: string
  contacts: { name: string; role: string; phone: string }[]
  contractRef: string
  docStatus: ClientDocStatus
  outstanding: string[]
  updated: string
  storageRef: string
  /** Access log; absent in seed data, appended when the file is opened. */
  history?: { at: string; by: string; action: string }[]
}

export const DOC_STATUS: Record<DocStatus, Status> = {
  valid: { tone: "ok", label: "Valid" },
  expiring: { tone: "warn", label: "Expiring soon" },
  expired: { tone: "bad", label: "Expired" },
  missing: { tone: "bad", label: "Missing" },
  unverified: { tone: "info", label: "Unverified" },
}

export const CLIENT_STATUS: Record<ClientDocStatus, Status> = {
  complete: { tone: "ok", label: "Complete" },
  incomplete: { tone: "warn", label: "Paperwork outstanding" },
  review: { tone: "info", label: "In review" },
}

export const FILES_PAGE_SIZE = 10

/** Toast shown when a secure file link is opened (shared by both tabs). */
export const OPEN_TOAST = "Secure link opened · access logged"
