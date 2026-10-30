import type { Status } from "@/lib/types"
import { nextId, requireReason } from "./logic"
import { STAFF_ROLE_LABEL } from "./permissions"
import type { StaffMember, StaffRole } from "./types"

// Platform team (Task 9, /platform/team, team.manage). Pure rules; the view writes the staff store and a D7 audit line.
// Staff must use two-step verification: a member without it shows "MFA required" and can't be given the owner role.

export const STAFF_STATUS: Record<StaffMember["status"], Status> = {
  active: { tone: "ok", label: "Active" },
  invited: { tone: "info", label: "Invited" },
  disabled: { tone: "mute", label: "Disabled" },
}

export const mfaLabel = (m: Pick<StaffMember, "mfa">): Status => (m.mfa ? { tone: "ok", label: "On" } : { tone: "warn", label: "MFA required" })

/** Owner is everything (D3), so it needs two-step verification switched on. */
export const canBeOwner = (m: Pick<StaffMember, "mfa">) => m.mfa

const OWNER_NEEDS_MFA = "Owners need two-step verification. Ask them to switch it on first."

type Ctx = { staff: StaffMember[]; operatorId: string }

/** Would this change leave no active owner? (Someone has to manage the team and settings.) */
const lastOwner = (m: StaffMember, staff: StaffMember[]) =>
  m.role === "owner" && m.status === "active" && !staff.some((s) => s.id !== m.id && s.role === "owner" && s.status === "active")

export function changeStaffRole(m: StaffMember, to: StaffRole, reason: string, ctx: Ctx): StaffMember {
  requireReason(reason)
  if (m.id === ctx.operatorId) throw new Error("You can't change your own role")
  if (m.status === "disabled") throw new Error("A disabled member can't be given a role")
  if (m.role === to) throw new Error(`${m.name} is already ${STAFF_ROLE_LABEL[to].toLowerCase()}`)
  if (to === "owner" && !canBeOwner(m)) throw new Error(OWNER_NEEDS_MFA)
  if (lastOwner(m, ctx.staff)) throw new Error("This is the last active owner. Make someone else owner first.")
  return { ...m, role: to }
}

export function disableStaff(m: StaffMember, reason: string, ctx: Ctx): StaffMember {
  requireReason(reason)
  if (m.id === ctx.operatorId) throw new Error("You can't disable yourself")
  if (m.status === "disabled") throw new Error(`${m.name} is already disabled`)
  if (lastOwner(m, ctx.staff)) throw new Error("This is the last active owner. Make someone else owner first.")
  return { ...m, status: "disabled" }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InviteInput = { name: string; email: string; role: StaffRole }

/** A new invited member: no MFA and no sign-in yet, so never an owner (they can be promoted once MFA is on). */
export function inviteStaff(staff: StaffMember[], input: InviteInput): StaffMember {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2) throw new Error("Enter their name")
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address")
  if (staff.some((s) => s.email.toLowerCase() === email)) throw new Error("That email is already on the team")
  if (input.role === "owner") throw new Error(OWNER_NEEDS_MFA)
  return { id: nextId("stf", staff.map((s) => s.id)), name, email, role: input.role, mfa: false, lastSignInAt: null, status: "invited" }
}

// ---------- Server view model ----------
/** The team page gets the staff list (the operator's own people, not tenant data) and who is signed in. */
export type TeamData = { operatorId: string; staff: StaffMember[] }
export const teamData = (d: { operatorId: string; staff: StaffMember[] }): TeamData => ({ operatorId: d.operatorId, staff: d.staff })
