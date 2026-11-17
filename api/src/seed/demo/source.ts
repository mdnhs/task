import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SeedRefused } from "./guards"

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
  plans: { id: string }[]
  loaded: string[]
}

/** Reads every mock file the seed uses (and says which). A missing or malformed file is a refusal, before anything is written. */
export function loadSource(dir: string): Source {
  const loaded: string[] = []
  const read = <T>(path: string): T => {
    try {
      const v = JSON.parse(readFileSync(join(dir, path), "utf8")) as T
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
    plans: read<{ id: string }[]>("billing/plans.json"),
    loaded,
  }
  read("shell/roles.json") // role keys are the tenant's role templates (createTenant seeds them from this file)
  read("settings/organisation.json") // timezones, weekend rule and session timeout options: display data, not tenant state
  return src
}

/** Every public/data file the seed deliberately does NOT load: features that have no backend module yet (FE-only, ruling I16/J2), display data and platform data. */
export const NOT_SEEDED: Record<string, string> = {
  "rosters/*": "FE-only, no backend module yet; stays on the mock",
  "staff-rosters/*": "FE-only incident and cover model; stays on the mock",
  "orders/*": "FE-only Orders & Stock; stays on the mock",
  "recruitment/*": "FE-only; stays on the mock",
  "payroll/*": "FE-only; stays on the mock",
  "files/*": "FE-only client and employee files (they need object storage); stays on the mock",
  "assistant/*": "FE-only; stays on the mock",
  "platform/*": "platform plans, invoices and tenants are platform data, not demo-tenant data",
  "billing/invoices.json, billing/usage.json, billing/entitlements.json": "invoices come from the payment provider; usage is computed; entitlements are read by the API itself",
  "dashboard/*, attention/*, search/*, support/*, audit/*, account/*, auth/*": "read models the API computes (dashboard, attention, search), or display data",
  "settings/{branding,delivery-log,departments(sites),integrations,invites,notifications,privacy,roles-matrix}.json": "display data, provider state or per-user settings with no demo-tenant state to load",
}
