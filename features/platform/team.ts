import type { Status } from "@/lib/types"
import type { StaffMember } from "./types"

// Platform team labels (the live team page is features/platform/components/live-team.tsx on /v1/platform/staff). Staff must use two-step verification: the API refuses every platform request without it.

export const STAFF_STATUS: Record<StaffMember["status"], Status> = {
  active: { tone: "ok", label: "Active" },
  invited: { tone: "info", label: "Invited" },
  disabled: { tone: "mute", label: "Suspended" },
}

export const mfaLabel = (m: Pick<StaffMember, "mfa">): Status => (m.mfa ? { tone: "ok", label: "On" } : { tone: "warn", label: "MFA required" })
