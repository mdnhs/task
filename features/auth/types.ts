export type Country = { code: string; name: string; timezone: string; currency?: string; locale?: string }
export type TimezoneOption = { value: string; label: string }
export type PlanOption = {
  id: string
  name: string
  priceMonthly: number
  currency: string
  trialDays: number
  limits: { activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
}
export type RoleOption = { id: string; label: string }

export type OnboardingDefaults = {
  domain: string
  defaultPlan: string
  /** BCP 47 locale for plan prices and numbers on the sign-up page (no tenant yet). */
  locale: string
  countries: Country[]
  timezones: TimezoneOption[]
  deadline: string
  departments: string[]
  reportSections: string[]
  inviteRoles: string[]
}

export type SignUpData = { defaults: OnboardingDefaults; plans: PlanOption[]; roles: RoleOption[] }
export type OnboardingData = { defaults: OnboardingDefaults; roles: RoleOption[] }

/** Which social sign-in providers the API has configured (GET /v1/auth/providers). */
export type AuthProviders = { google: boolean; microsoft: boolean }

/** What an invitation link is for (GET /v1/invites/preview), shown before anyone signs in. */
export type InvitePreview = { company: string; email: string; roleKey: string; roleLabel: string; invitedBy: string | null; expiresAt: string; accountExists: boolean }
/** The /invite page's data: a usable invitation (with the signed-in address, if any) or the one reason it cannot be used. */
export type InviteData = { kind: "ready"; preview: InvitePreview; viewer: string | null } | { kind: "unusable"; reason: "invalid" | "expired" | "used" | "rate_limited" | "error"; message: string }
