import { cookies } from "next/headers"

import { hasSessionCookie } from "@/lib/api/cookies"
import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import type { AuthProviders, OnboardingData, OnboardingDefaults, PlanOption, RoleOption, SignUpData } from "./types"

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

/** The social buttons the sign-in page shows: only providers the API has configured (id and secret). The API being down shows none (the form still works). */
export async function getProviders(): Promise<AuthProviders> {
  try {
    const p = await (await apiServer({ tenant: null })).get("/v1/auth/providers")
    return { google: p.google, microsoft: p.microsoft }
  } catch {
    return { google: false, microsoft: false }
  }
}

export async function getSignUpData(): Promise<SignUpData> {
  const [defaults, plans, roles] = await Promise.all([getDefaults(), getPlans(), getRoles()])
  return { defaults, plans, roles }
}

export async function getOnboardingData(): Promise<OnboardingData> {
  const [defaults, roles] = await Promise.all([getDefaults(), getRoles()])
  return { defaults, roles }
}

/** The signed-in person's email for the invitation page, or null when nobody (or a dead session) is signed in: the page then offers sign-in or sign-up. Never throws. */
export async function getInviteViewer(): Promise<string | null> {
  if (!hasSessionCookie((await cookies()).getAll().map((c) => c.name))) return null
  try {
    return (await (await apiServer({ tenant: null })).get("/v1/me")).user.email
  } catch {
    return null
  }
}
