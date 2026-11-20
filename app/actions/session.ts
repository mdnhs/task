"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { apiUrl, appOrigin } from "@/lib/api/config"
import { allowedCookiePairs, hasSessionCookie } from "@/lib/api/cookies"
import { ApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { isTenantSlug } from "@/lib/api/tenant"
import { makeAuthClient } from "@/lib/auth-client"
import { isInviteTarget, safeNext } from "@/lib/safe-next"
import { EXPIRED_PATH, canWrite, getSession } from "@/lib/session"
import { clearTenantSlug, writeTenantSlug } from "@/lib/tenant-cookie"

const BETTER_AUTH_COOKIE = /^(?:__Secure-)?better-auth\./

// The one writer of the active-company cookie (B6 I5): the slug must be one of the caller's own memberships (GET /v1/me) AND the API must answer for it
// (a removed or suspended membership is a 404 there). A client can send any string; nothing here trusts it. Returns whether the cookie was set.
export async function switchTenant(slug: string): Promise<{ ok: boolean }> {
  if (typeof slug !== "string" || !isTenantSlug(slug)) return { ok: false }
  const jar = await cookies()
  if (!hasSessionCookie(jar.getAll().map((c) => c.name))) return redirect("/sign-in")
  try {
    const me = await (await apiServer({ tenant: null })).get("/v1/me")
    if (!me.tenants.some((t) => t.slug === slug)) return { ok: false }
    try {
      await (await apiServer({ tenant: slug })).get("/v1/me/tenant")
    } catch (e) {
      // The API reaches its MFA check only after it has verified the membership, so these two still prove it (the gate is shown inside that company).
      const mfa = e instanceof ApiError && e.status === 401 && (e.code === "mfa_enrolment_required" || e.code === "mfa_challenge")
      if (!mfa) throw e
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return redirect(EXPIRED_PATH)
    return { ok: false } // not a member any more, or the API is unreachable: never set a cookie on a guess
  }
  await writeTenantSlug(slug)
  revalidatePath("/", "layout")
  return { ok: true }
}

// Called by the sign-in flow once the browser holds the session cookie (after the password step, or the code step for 2FA users).
// od-tenant = the first membership; staff with no company go to the console, anyone else with none to onboarding. `next` is validated (same origin, path only).
// The one exception: an invitation link (/invite?token=...) is followed even with no company yet, so an invited member joins the inviter's company.
export async function afterSignIn(next?: string): Promise<void> {
  let me
  try {
    me = await (await apiServer({ tenant: null })).get("/v1/me")
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return redirect("/sign-in")
    throw e
  }
  const target = safeNext(next)
  const first = me.tenants[0]
  if (!first) return redirect(isInviteTarget(target) ? target : me.platformRole ? "/platform" : "/onboarding")
  await writeTenantSlug(first.slug)
  return redirect(target)
}

// Ends the session on the API (Better Auth revokes it, so a stolen copy of the cookie dies too) and clears this browser's cookies. The cookies are cleared
// even when the API call fails: the visitor asked to be signed out of this browser.
export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  const cookie = allowedCookiePairs(jar.getAll())
  const origin = appOrigin()
  if (cookie) {
    try {
      await makeAuthClient({ baseUrl: `${apiUrl()}/api/auth`, headers: () => new Headers({ cookie, ...(origin ? { origin } : {}) }) }).signOut()
    } catch {
      /* revocation is best effort; the local clear below always happens */
    }
  }
  for (const { name } of jar.getAll()) {
    if (!BETTER_AUTH_COOKIE.test(name)) continue
    // A __Secure- cookie can only be overwritten with the Secure attribute, so expire it explicitly instead of delete().
    if (name.startsWith("__Secure-")) jar.set(name, "", { maxAge: 0, path: "/", secure: true, httpOnly: true, sameSite: "lax" })
    else jar.delete(name)
  }
  await clearTenantSlug()
  redirect("/sign-in")
}
