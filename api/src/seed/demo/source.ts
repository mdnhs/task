import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { SeedRefused } from "./guards"

// The three task files (tasks, projects, templates) live next to the seed, not in public/data: the web no longer reads them (B6 T6.8) and
// public/ is what the web serves and ships. Same shapes as before; the seed is their only reader.
export const SEED_FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url))
const FIXTURE_FILES = new Set(["tasks/tasks.json", "tasks/projects.json", "tasks/templates.json"])
export const sourcePath = (dir: string, path: string): string => (FIXTURE_FILES.has(path) ? join(SEED_FIXTURES, path.slice("tasks/".length)) : join(dir, path))

// The mock JSON the seed reads. Shapes are the mock's own (public/data/<feature>/*.json); only the fields the seed uses are typed.
export type MockUser = { id: string; name: string; email: string; role: string; dept: string; status: string }
export type MockPerson = { id: string; name: string; role: string; dept: string }
export type MockMember = { personId: string; teams: string[]; managerId: string | null }
export type MockPattern = { id: string; name: string; team: string; start: string; end: string; days: number[]; timeZone?: string }
export type MockAssignment = { personId: string; patternId: string; from: string; until?: string }
export type MockRule = { mode: "none" | "optional" | "required"; types: string[]; min: number; instruction: string; review: "auto" | "creator" | "manager" | "named"; reviewer?: string }
export type MockEvidence = { id: string; kind: string; name: string; by: string; at: string; review: string; source?: string; round?: number; locked?: boolean; reason?: string }
export type MockTask = {
  ref: string; title: string; description: string; dept: string; assignee: string; assignees?: string[]; creator: string; priority: number; start: string; due: string; status: string
  evidenceRule: MockRule; client?: string; tags?: string[]; estimate?: number; submittedAt?: string; completedAt?: string; archivedAt?: string; archivedBy?: string
  notes: { at: string; by: string; text: string }[]; evidence: MockEvidence[]; timeline: { at: string; by: string; text: string }[]
  checklist?: { id: string; text: string; done: boolean }[]; dependsOn?: string[]; parentRef?: string; projectId?: string; milestoneId?: string
  repeat?: { freq: string; days?: number[]; dayOfMonth?: number; until?: string }
  overdue?: { reason: string; nextAction: string; owner: string; revisedDue: string }
  proposal?: { start: string; due: string; reason: string; by: string; at: string }
}
export type MockProject = { id: string; name: string; dept: string; lead: string; description: string; due: string; milestones: { id: string; name: string; due: string }[] }
export type MockTemplate = { id: string; name: string; title: string; description: string; dept: string; priority: number; tags: string[]; evidenceRule: MockRule; dueOffset: number; dueTime: string }
export type MockReport = {
  id: string; personId: string; patternId: string; date: string; status: string; createdAt: string; updatedAt: string; submittedAt?: string; reviewedBy?: string; reviewedAt?: string
  items: { taskRef: string; status: string; minutes: number; note: string }[]; summary: string; blockers: string; unplanned: { id: string; text: string; minutes: number }[]
  attachments: unknown[]; extra: Record<string, string>; comments: { at: string; by: string; text: string }[]; versions: { v: number; at: string; by: string; note: string }[]
}
export type MockTenant = { id: string; name: string; slug: string; brand: string; status: string; plan: string; trialEndsOn?: string; graceEndsOn?: string }
export type MockDevice = { id: string; userId: string; type: "pc" | "android" | "browser"; owner: "company" | "personal"; label: string; trusted: boolean; lastSeen: string }
export type MockNotification = { id: string; type: string; title: string; at: string; read: boolean; href: string }
export type MockRosters = {
  locations: { id: string; name: string; address: string; pin: { lat: number; lng: number }; zoneRadiusM: number; openingHours: string; contact: string; swapApprovalDelegated: boolean }[]
  templates: { id: string; locationId: string; name: string; start: string; end: string; unpaidBreakMin: number; role: string; requires: string[] }[]
  targets: { locationId: string; templateId: string; weekday: number; count: number }[]
  weeks: { id: string; locationId: string; weekStart: string; status: "draft" | "published"; publishedAt: string | null; publishedBy: string | null; autoRepeatDays: number | null }[]
  shifts: { id: string; weekId: string; locationId: string; date: string; personId: string | null; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number; confirmedAt: string | null }[]
  history: { id: string; weekId: string | null; locationId: string; shiftId: string | null; at: string; by: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null }[]
  requests: { id: string; weekId: string; shiftId: string; by: string; at: string; patch: Record<string, unknown>; why: string; status: string; decidedBy: string | null; decidedAt: string | null; note: string | null }[]
  claims: { id: string; shiftId: string; personId: string; at: string; status: string; decidedBy: string | null; decidedAt: string | null }[]
  swaps: { id: string; shiftId: string; fromPersonId: string; toPersonId: string | null; at: string; status: string }[]
  leave: { id: string; personId: string; from: string; to: string; kind: string; status: string; decidedBy: string | null; decidedAt: string | null }[]
  availability: { personId: string; weekday: number; from: string; to: string }[]
  workforce: { id: string; homeLocationId: string; qualifications: { type: string; expires: string | null }[]; leftOn?: string }[]
  weekTemplates: { id: string; name: string; locationId: string; shifts: { day: number; personId: string | null; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number }[] }[]
  access: { grants: { locationId: string; personId: string }[]; limits: { personId: string; except: string[] }[] }
  rules: { avgWeekReferenceWeeks: number; severity: Record<string, string> }
  /** staff-rosters/staff.json: the names behind the `s-...` ids the roster files use (only the ids the roster data names are ever made people). */
  staff: { id: string; name: string; role: string; dept: string; personId?: string }[]
}
export type MockSubscription = { planId: string; status: string; renewsOn: string; cardLast4: string | null }

export type Source = {
  tenants: MockTenant[]
  subscriptions: Record<string, MockSubscription>
  org: { today: string; timezone: string; currency: string; locale: string; deadline: string }
  shellUser: { name: string; email: string }
  users: MockUser[]
  people: MockPerson[]
  members: MockMember[]
  patterns: MockPattern[]
  assignments: MockAssignment[]
  reporting: { reportDueAfterMinutes: number; teamDefaults: Record<string, boolean>; overrides: Record<string, boolean> }
  departments: { name: string }[]
  devices: MockDevice[]
  devicePolicies: { feature: string; allow: string }[]
  holidays: { date: string; name: string }[]
  reportTemplate: { dept: string; sections: unknown[] }[]
  projects: MockProject[]
  templates: MockTemplate[]
  tasks: MockTask[]
  reports: MockReport[]
  notifications: MockNotification[]
  rosters: MockRosters
  plans: { id: string }[]
  loaded: string[]
}

function loadRosters(read: <T>(path: string) => T): MockRosters {
  const f = <K extends string, T>(file: string, key: K): T => (read<Record<K, T>>(`rosters/${file}.json`))[key]
  return {
    locations: f("locations", "locations"), templates: f("templates", "templates"), targets: f("targets", "targets"), weeks: f("weeks", "weeks"), shifts: f("shifts", "shifts"),
    history: f("history", "history"), requests: f("requests", "requests"), claims: f("claims", "claims"), swaps: f("swaps", "swaps"), leave: f("leave", "leave"),
    availability: f("availability", "availability"), workforce: f("workforce", "extras"), weekTemplates: f("week-templates", "weekTemplates"), access: read<MockRosters["access"]>("rosters/access.json"),
    rules: read<MockRosters["rules"]>("rosters/rules.json"), staff: read<{ staff: MockRosters["staff"] }>("staff-rosters/staff.json").staff,
  }
}

/** Reads every mock file the seed uses (and says which). A missing or malformed file is a refusal, before anything is written. */
export function loadSource(dir: string): Source {
  const loaded: string[] = []
  const read = <T>(path: string): T => {
    try {
      const v = JSON.parse(readFileSync(sourcePath(dir, path), "utf8")) as T
      loaded.push(path)
      return v
    } catch {
      throw new SeedRefused("bad_source")
    }
  }
  const holidays = read<{ holidays: Record<string, Record<string, { date: string; name: string }[]>> }>("settings/public-holidays.json").holidays
  const reporting = read<Source["reporting"]>("shifts/reporting.json")
  const org = read<Source["org"]>("shell/org.json")
  const devices = read<{ devices: MockDevice[]; policies: { feature: string; allow: string }[] }>("settings/devices.json")
  const src: Source = {
    tenants: read<{ tenants: MockTenant[] }>("shell/tenants.json").tenants,
    subscriptions: read<{ tenants: Record<string, MockSubscription> }>("billing/subscription.json").tenants,
    org,
    shellUser: read<Source["shellUser"]>("shell/user.json"),
    users: read<{ users: MockUser[] }>("settings/users.json").users,
    people: read<{ people: MockPerson[] }>("tasks/people.json").people,
    members: read<{ members: MockMember[] }>("shifts/members.json").members,
    patterns: read<{ patterns: MockPattern[] }>("shifts/patterns.json").patterns,
    assignments: read<{ assignments: MockAssignment[] }>("shifts/assignments.json").assignments,
    reporting,
    departments: read<{ departments: { name: string }[] }>("settings/departments.json").departments,
    devices: devices.devices,
    devicePolicies: devices.policies,
    holidays: Object.values(holidays.IE ?? {}).flat(),
    reportTemplate: read<{ departments: Source["reportTemplate"] }>("settings/template.json").departments,
    projects: read<{ projects: MockProject[] }>("tasks/projects.json").projects,
    templates: read<{ templates: MockTemplate[] }>("tasks/templates.json").templates,
    tasks: read<{ tasks: MockTask[] }>("tasks/tasks.json").tasks,
    reports: read<{ reports: MockReport[] }>("reports/reports.json").reports,
    notifications: read<MockNotification[]>("shell/notifications.json"),
    rosters: loadRosters(read),
    plans: read<{ id: string }[]>("billing/plans.json"),
    loaded,
  }
  read("shell/roles.json") // role keys are the tenant's role templates (createTenant seeds them from this file)
  read("settings/organisation.json") // timezones, weekend rule and session timeout options: display data, not tenant state
  return src
}

/** Every public/data file the seed deliberately does NOT load: features that have no backend module yet (FE-only, ruling I16/J2), display data and platform data. */
export const NOT_SEEDED: Record<string, string> = {
  "staff-rosters/{incidents,roster-gaps}.json": "FE-only incident and cover model; stays on the mock (staff-rosters/staff.json is read only for the names behind the roster files' person ids)",
  "orders/*": "FE-only Orders & Stock; stays on the mock",
  "recruitment/*": "FE-only; stays on the mock",
  "payroll/*": "FE-only; stays on the mock",
  "files/*": "FE-only client and employee files (they need object storage); stays on the mock",
  "assistant/*": "FE-only; stays on the mock",
  "platform/*": "platform plans, invoices and tenants are platform data, not demo-tenant data",
  "billing/invoices.json, billing/usage.json, billing/entitlements.json": "invoices come from the payment provider; usage is computed; entitlements are read by the API itself",
  "dashboard/*, attention/*, search/*, support/*, account/*, auth/*": "read models the API computes (dashboard, attention, search), or display data",
  "settings/{branding,delivery-log,departments(sites),notifications}.json": "display data, provider state or per-user settings with no demo-tenant state to load",
}
