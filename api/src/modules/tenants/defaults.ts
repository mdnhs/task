import { readFileSync } from "node:fs"

// Tenant defaults come from data, never code (FR-M0-20): public/data/auth/onboarding-defaults.json and
// public/data/shell/roles.json. The Dockerfile copies both next to /app/api.
const DATA = new URL("../../../../public/data/", import.meta.url)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, DATA), "utf8")) as T
}

type OnboardingDefaults = { locale: string; timezones: { value: string }[]; inviteRoles: string[]; deadline: string }
type RoleTemplate = { id: string; label: string; description?: string; home: string; access: Record<string, string>; platform?: boolean; reportScope?: "team" }

let defaults: OnboardingDefaults | undefined
export function onboardingDefaults(): { timezone: string; locale: string; inviteRoles: string[]; deadline: string } {
  defaults ??= readJson<OnboardingDefaults>("auth/onboarding-defaults.json")
  return { timezone: defaults.timezones[0].value, locale: defaults.locale, inviteRoles: defaults.inviteRoles, deadline: defaults.deadline }
}

let templates: RoleTemplate[] | undefined
/** Every role template in roles.json except the platform operator role, which is never a tenant role. */
export function roleTemplates(): RoleTemplate[] {
  templates ??= readJson<{ roles: RoleTemplate[] }>("shell/roles.json").roles.filter((r) => r.id !== "platform" && !r.platform)
  return templates
}

/** The reportScope a role template declares in roles.json ("team" = sees only the people below it). */
export function templateReportScope(key: string): "team" | undefined {
  return roleTemplates().find((r) => r.id === key)?.reportScope
}
