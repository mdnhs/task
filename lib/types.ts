// Types shared by more than one feature. Feature-only types live in features/<feature>/types.ts.

export type Tone = "ok" | "warn" | "bad" | "info" | "mute"
export type Status = { tone: Tone; label: string }

export type Dept = "all" | "Security" | "Cleaning"

// Session / tenancy (see lib/permissions.ts, lib/session.ts)
export type Module = "dashboard" | "tasks" | "reports" | "attention" | "staff" | "recruitment" | "files" | "payroll" | "orders" | "settings" | "audit" | "whatsapp"
export type Access = "none" | "read" | "write"
export type Role = { id: string; label: string; description: string; home: "manager" | "staff"; access: Record<Module, Access>; platform?: boolean }
export type Tenant = {
  id: string
  name: string
  slug: string
  initials: string
  brand: string
  status: "trial" | "active" | "past_due" | "suspended"
  plan: string
  trialEndsOn?: string
  graceEndsOn?: string
}

// The people cast (mock directory, see lib/people.ts). Shared by tasks, reports and dashboard.
export type Person = { id: string; name: string; role: string; initials: string; avatar: "av1" | "av2" | "av3" | "av4" | "av5" | "av6"; dept: string }
