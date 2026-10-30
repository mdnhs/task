export type Country = { code: string; name: string; timezone: string }
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
