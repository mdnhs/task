"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { hasSessionCookie } from "@/lib/api/cookies"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { acceptInviteStep, registerInviteStep, type AcceptInviteResult, type InviteFailure } from "@/lib/auth-flow"
import { writeTenantSlug } from "@/lib/tenant-cookie"

// Accepts an invitation (POST /v1/invites/accept) for the signed-in caller. The API checks everything that matters (the token, that the invited address
// is the caller's, expiry, the inviter's standing, seats). od-tenant is written only AFTER the API confirmed the membership, then the person lands in
// that company. Any failure comes back as a result (never a thrown error) so the page can say what to do; only success redirects.
export async function acceptInvite(token: string): Promise<Exclude<AcceptInviteResult, { ok: true }>> {
  const signedIn = hasSessionCookie((await cookies()).getAll().map((c) => c.name))
  // The invitation names the company, so no tenant is sent: the caller may have none yet.
  const api = signedIn ? await apiServer({ tenant: null }) : null
  const r = await acceptInviteStep(
    {
      accept: async (t) => {
        if (!api) throw new ApiError(401, "unauthenticated")
        return api.post("/v1/invites/accept", { body: { token: t } })
      },
    },
    typeof token === "string" ? token : "",
  )
  if (!r.ok) return r
  await writeTenantSlug(r.slug)
  revalidatePath("/", "layout")
  return redirect("/")
}

// One-step join for a visitor with no account yet (POST /v1/invites/register): the invitation link proves the address, so the API creates a verified account and
// joins the company in one call. It creates no session: the browser then signs in with the same password (the ordinary sign-in) and lands in the company.
// The address is the invitation's, never the caller's. Public on the API side, so no session is needed here; nothing is written on this side.
export async function registerInvite(input: { token: string; name: string; password: string }): Promise<{ ok: true; slug: string; email: string } | InviteFailure> {
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const api = await apiServer({ tenant: null })
  return registerInviteStep({ register: (b) => api.post("/v1/invites/register", { body: b }) }, { token: str(input?.token), name: str(input?.name), password: str(input?.password) })
}
