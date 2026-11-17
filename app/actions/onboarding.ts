"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { hasSessionCookie } from "@/lib/api/cookies"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import { currencyAndLocale, onboardingInput, slugCandidates, type OnboardingInput } from "@/lib/onboarding"
import { EXPIRED_PATH } from "@/lib/session"
import { writeTenantSlug } from "@/lib/tenant-cookie"

type Defaults = { countries: { timezone: string; currency?: string; locale?: string }[] }
export type OnboardingResult = { ok: true; slug: string; invited: number; failedInvites: number } | { ok: false; error: "invalid" | "slug_taken" | "failed" }

// First-run set-up (FR-SAAS-04): creates the company the signed-in person owns (POST /v1/tenants), then its first settings, teams and invites.
// Everything the browser sends is re-validated (lib/onboarding.ts) and again by the API. od-tenant is written only AFTER the API confirmed the
// company exists (the caller is its owner); a team or invite that fails does not undo the company.
export async function completeOnboarding(raw: OnboardingInput): Promise<OnboardingResult> {
  const parsed = onboardingInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "invalid" }
  const input = parsed.data

  if (!hasSessionCookie((await cookies()).getAll().map((c) => c.name))) return redirect("/sign-in")
  const bare = await apiServer({ tenant: null })
  try {
    await bare.get("/v1/me")
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return redirect(EXPIRED_PATH)
    return { ok: false, error: "failed" }
  }

  const { countries } = await getData<Defaults>("auth/onboarding-defaults.json")
  const money = currencyAndLocale(countries, input.timezone)
  let slug: string | null = null
  let taken = false
  for (const candidate of slugCandidates(input.company)) {
    try {
      const created = await bare.post("/v1/tenants", { body: { name: input.company, slug: candidate, timezone: input.timezone, ...money } })
      slug = created.slug
      break
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "slug_taken") {
        taken = true
        continue
      }
      if (e instanceof ApiError && e.status === 401) return redirect(EXPIRED_PATH)
      return { ok: false, error: "failed" }
    }
  }
  if (!slug) return { ok: false, error: taken ? "slug_taken" : "failed" }

  const api = await apiServer({ tenant: slug })
  await api.patch("/v1/settings/organisation", { body: { reportDeadline: input.deadline } }).catch(() => {})
  for (const name of input.departments) await api.post("/v1/teams", { body: { name, kind: "team" } }).catch(() => {})

  let invited = 0
  let failedInvites = 0
  if (input.invites.length > 0) {
    const roles = new Map((await api.get("/v1/roles").catch(() => [])).map((r) => [r.key, r.id]))
    for (const inv of input.invites) {
      const roleId = roles.get(inv.roleKey)
      if (!roleId) {
        failedInvites += 1
        continue
      }
      try {
        await api.post("/v1/invites", { body: { email: inv.email, roleId } })
        invited += 1
      } catch {
        failedInvites += 1
      }
    }
  }

  await writeTenantSlug(slug)
  revalidatePath("/", "layout")
  return { ok: true, slug, invited, failedInvites }
}
