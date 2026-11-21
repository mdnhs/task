import { cookies } from "next/headers"

import { hasSessionCookie } from "@/lib/api/cookies"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import { inviteFailure } from "@/lib/auth-flow"
import type { AuthProviders, InviteData, OnboardingData, OnboardingDefaults, PlanOption, RoleOption, SignUpData } from "./types"

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

/**
 * The /invite page: what the link is for plus who (if anyone) is signed in. Reads only (the invitation is not used up by looking). A bad, revoked, expired or used
 * link, or the API being unavailable, is one `unusable` state with its short copy, never a thrown error.
 */
export async function getInviteData(token: string): Promise<InviteData> {
  if (!token) return { kind: "unusable", reason: "invalid", message: inviteFailure(new ApiError(404, "invite_not_found")).message }
  try {
    const [preview, viewer] = await Promise.all([(await apiServer({ tenant: null })).get("/v1/invites/preview", { query: { token } }), getInviteViewer()])
    return { kind: "ready", preview, viewer }
  } catch (e) {
    const f = inviteFailure(e)
    const reason = f.kind === "expired" || f.kind === "used" || f.kind === "rate_limited" || f.kind === "invalid" ? f.kind : "error"
    return { kind: "unusable", reason, message: f.message }
  }
}
