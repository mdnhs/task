"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { hasSessionCookie } from "@/lib/api/cookies"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { acceptInviteStep, type AcceptInviteResult } from "@/lib/auth-flow"
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
