// The two cookie-writing detours of the session (B6 T6.3). A server component cannot set or delete a cookie, so when getSession finds a dead
// session or a stale od-tenant it redirects here (app/api/session/*), where a route handler can. Both are plain GETs on purpose (a redirect target),
// both are idempotent and both only ever make the cookies MATCH what the API confirms:
//  - expired: clears the Better Auth cookies and od-tenant, but ONLY when the API itself says the session is dead (a valid session is never cleared, so a
//    cross-site link cannot sign anybody out), then /sign-in?reason=expired. The sign-in page never redirects back, so there is no loop.
//  - tenant: sets od-tenant to a membership the API confirms (the cookie's if it is one, else the first that answers), via the same resolveSession
//    as getSession so the two can never disagree, then returns to a SAFE same-origin path.
import { NextResponse } from "next/server"
import { apiUrl, appOrigin } from "./api/config"
import { makeApiClient } from "./api/client"
import { allowedCookieHeader, cookieValue, hasSessionCookie, isSessionCookieName } from "./api/cookies"
import { ApiError } from "./api/problem"
import { TENANT_COOKIE, isTenantSlug, tenantCookieOptions } from "./api/tenant"
import { getData } from "./data"
import type { EntitlementsData } from "./entitlements"
import { safeNext } from "./safe-next"
import { resolveSession, type SessionDeps } from "./session-core"
import type { Role } from "./types"

const BETTER_AUTH_COOKIE = /^(?:__Secure-)?better-auth\./

function cookieNames(header: string | null): string[] {
  return (header ?? "").split(";").map((p) => p.split("=")[0]!.trim()).filter(Boolean)
}

function redirectTo(req: Request, path: string): NextResponse {
  const base = appOrigin() ?? new URL(req.url).origin
  const res = NextResponse.redirect(new URL(path, base), 303)
  res.headers.set("cache-control", "no-store")
  return res
}

function clear(res: NextResponse, names: string[]): void {
  const production = process.env.NODE_ENV === "production"
  for (const name of names) res.cookies.set({ name, value: "", maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure: production || name.startsWith("__Secure-") })
}

const authCookies = (req: Request) => cookieNames(req.headers.get("cookie")).filter((n) => BETTER_AUTH_COOKIE.test(n))

function depsFor(req: Request): SessionDeps {
  const header = req.headers.get("cookie")
  const raw = cookieValue(header, TENANT_COOKIE)
  const cookie = allowedCookieHeader(header)
  return {
    hasSessionCookie: hasSessionCookie(cookieNames(header)),
    tenantCookie: isTenantSlug(raw) ? raw : null,
    api: async (o) =>
      makeApiClient({ baseUrl: apiUrl(), cache: "no-store", headers: () => { const h = new Headers(); if (cookie) h.set("cookie", cookie); if (isTenantSlug(o?.tenant)) h.set("x-tenant", o.tenant); return h } }),
    entitlementsData: () => getData<EntitlementsData>("billing/entitlements.json"),
    staticRoles: async () => (await getData<{ roles: Role[] }>("shell/roles.json")).roles,
  }
}

/** GET /api/session/expired */
export async function expireSession(req: Request): Promise<NextResponse> {
  const header = req.headers.get("cookie")
  if (!hasSessionCookie(cookieNames(header))) {
    const res = redirectTo(req, "/sign-in?reason=expired")
    clear(res, [...authCookies(req), TENANT_COOKIE])
    return res
  }
  try {
    await makeApiClient({ baseUrl: apiUrl(), cache: "no-store", headers: () => new Headers({ cookie: allowedCookieHeader(header) }) }).get("/v1/me")
    return redirectTo(req, "/") // the session is fine: nothing to clear
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const res = redirectTo(req, "/sign-in?reason=expired")
      clear(res, [...authCookies(req), TENANT_COOKIE])
      return res
    }
    return redirectTo(req, "/sign-in") // unreachable or unexpected: keep the cookies, it may be a blip
  }
}

/** GET /api/session/tenant?next=/path */
export async function repairTenant(req: Request): Promise<NextResponse> {
  const deps = depsFor(req)
  let r
  try {
    r = await resolveSession(deps)
  } catch {
    return redirectTo(req, "/sign-in")
  }
  switch (r.kind) {
    case "anonymous":
      return redirectTo(req, "/sign-in")
    case "expired": {
      const res = redirectTo(req, "/sign-in?reason=expired")
      clear(res, [...authCookies(req), TENANT_COOKIE])
      return res
    }
    case "no_tenant": {
      const res = redirectTo(req, r.me.platformRole ? "/platform" : "/onboarding")
      if (deps.tenantCookie) clear(res, [TENANT_COOKIE])
      return res
    }
    case "ok": {
      const res = redirectTo(req, safeNext(new URL(req.url).searchParams.get("next")))
      if (r.cookieStale) res.cookies.set(TENANT_COOKIE, r.session.tenantSlug, tenantCookieOptions())
      return res
    }
  }
}

export { isSessionCookieName }
