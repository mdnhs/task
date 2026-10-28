import { getData } from "@/lib/data"
import type { OnboardingData, OnboardingDefaults, PlanOption, RoleOption, SignUpData } from "./types"

type ShellRole = { id: string; label: string }

// Plans are the billing seed, read from the same file (not a copy) so names and limits never drift.
async function getPlans() {
  return getData<PlanOption[]>("billing/plans.json")
}

async function getRoles(): Promise<RoleOption[]> {
  const { roles } = await getData<{ roles: ShellRole[] }>("shell/roles.json")
  return roles.map((r) => ({ id: r.id, label: r.label }))
}

const getDefaults = () => getData<OnboardingDefaults>("auth/onboarding-defaults.json")

/** Roles offered on the "Continue as" step. */
export const getSignInRoles = getRoles

export async function getSignUpData(): Promise<SignUpData> {
  const [defaults, plans, roles] = await Promise.all([getDefaults(), getPlans(), getRoles()])
  return { defaults, plans, roles }
}

export async function getOnboardingData(): Promise<OnboardingData> {
  const [defaults, roles] = await Promise.all([getDefaults(), getRoles()])
  return { defaults, roles }
}
