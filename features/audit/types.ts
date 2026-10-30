import type { Tone } from "@/lib/types"

export type AuditAction =
  | "sign_in"
  | "failed_sign_in"
  | "role_change"
  | "deactivation"
  | "export"
  | "status_change"
  | "report_submitted"
  | "report_reviewed"
  | "report_returned"
  | "decision"
  | "invite"
  | "billing"
  | "purge"

export type AuditEvent = {
  id: string
  /** ISO local time in the tenant timezone. */
  at: string
  actor: string
  actorRole: string
  action: AuditAction
  recordType: string
  recordRef: string
  ip: string
  device: string
  sensitive: boolean
  /** Key/value metadata shown in the expanded row. */
  meta: Record<string, string>
  /** lib/audit-outbox key of an event recorded on another screen, so it is merged once. */
  sourceKey?: string
}

export const ACTION: Record<AuditAction, { label: string; tone: Tone }> = {
  sign_in: { label: "Sign-in", tone: "mute" },
  failed_sign_in: { label: "Failed sign-in", tone: "bad" },
  role_change: { label: "Role change", tone: "warn" },
  deactivation: { label: "Deactivation", tone: "bad" },
  export: { label: "Export", tone: "info" },
  status_change: { label: "Status change", tone: "mute" },
  report_submitted: { label: "Report submitted", tone: "info" },
  report_reviewed: { label: "Report reviewed", tone: "ok" },
  report_returned: { label: "Report returned", tone: "warn" },
  decision: { label: "Decision", tone: "ok" },
  invite: { label: "Invite", tone: "info" },
  billing: { label: "Billing", tone: "warn" },
  purge: { label: "Deleted for good", tone: "bad" },
}

export type AuditFilters = { q: string; actor: string; action: string; recordType: string; from: string; to: string }
