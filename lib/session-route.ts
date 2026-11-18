// The two cookie-writing detours of the session (B6 T6.3, B7 T12). A server component cannot set or delete a cookie, so when getSession finds a dead
// session or a stale od-tenant it redirects here (app/api/session/*), where a route handler can. A redirect is always a GET, so:
//  - expired stays a GET (it only clears, and only when the API says the session is dead: a cross-site link cannot sign anybody out);
//  - tenant WRITES a cookie, so the write is a POST (same-origin form or JSON, Origin checked like the BFF); its GET never mutates anything: it answers a
//    tiny page whose form posts itself, which is how a redirect target reaches the POST. The form is our own page, so the POST's Origin check passes even after a foreign link: the protection is that the cookie is only ever set to a membership the API verified for THIS user (nobody can choose a tenant; the worst a link can do is a nuisance switch among the user's own companies).
// Both only ever make the cookies MATCH what the API confirms:
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
import { violatesSameOrigin } from "./csrf"
import { safeNext } from "./safe-next"
import { resolveSession, type SessionDeps } from "./session-core"
import type { Role } from "./types"

const TENANT_ROUTE = "/api/session/tenant"
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

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** GET /api/session/tenant?next=/path: never writes and never calls the API. A self-submitting same-origin form that POSTs `next` (validated here too). */
export function repairTenantPage(req: Request): Response {
  const next = escapeAttr(safeNext(new URL(req.url).searchParams.get("next")))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Continuing</title></head>` +
    `<body><form id="f" method="post" action="${TENANT_ROUTE}"><input type="hidden" name="next" value="${next}"><noscript><button type="submit">Continue</button></noscript></form>` +
    `<script>document.getElementById("f").submit()</script></body></html>`
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "same-origin" } })
}

async function readNext(req: Request): Promise<string | null> {
  try {
    const type = req.headers.get("content-type") ?? ""
    if (type.includes("application/json")) {
      const v = ((await req.json()) as { next?: unknown } | null)?.next
      return typeof v === "string" ? v : null
    }
    const v = (await req.formData()).get("next")
    return typeof v === "string" ? v : null
  } catch {
    return null
  }
}

/** POST /api/session/tenant, body { next } (JSON or form). Same-origin only. */
export async function repairTenant(req: Request): Promise<NextResponse> {
  const origin = appOrigin()
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  // Fail closed like the BFF: in production an unknown web origin refuses; only development and tests fall back to the request's own Host.
  if ((origin === null && process.env.NODE_ENV === "production") || violatesSameOrigin(req.headers, { origin, host })) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } })
  }
  const nextParam = await readNext(req)
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
      const res = redirectTo(req, safeNext(nextParam))
      if (r.cookieStale) res.cookies.set(TENANT_COOKIE, r.session.tenantSlug, tenantCookieOptions())
      return res
    }
  }
}

export { isSessionCookieName }
