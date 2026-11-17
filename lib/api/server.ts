// Server components and server actions call API_URL directly, no BFF hop (B6 ruling I4).
// The call carries ONLY what the server derives: the allow-listed cookies, X-Tenant from the httpOnly od-tenant cookie, Origin on writes
// (Better Auth rejects a cookie-bearing write without one), a request id, and no-store caching. Nothing a client sent is trusted:
// the incoming x-tenant, authorization and x-od-* headers are never read.
import "server-only"
import { cookies, headers as requestHeaders } from "next/headers"
import { apiUrl, appOrigin } from "./config"
import { allowedCookiePairs } from "./cookies"
import { makeApiClient, type ApiClient } from "./client"
import { TENANT_COOKIE, TENANT_HEADER, isTenantSlug } from "./tenant"

/** The typed API client for the current request. Build it per request (it reads this request's cookies); it is cheap. */
export async function apiServer(): Promise<ApiClient> {
  const [jar, incoming] = await Promise.all([cookies(), requestHeaders()])
  const cookie = allowedCookiePairs(jar.getAll())
  const slug = jar.get(TENANT_COOKIE)?.value
  const userAgent = incoming.get("user-agent")
  const forwardedFor = incoming.get("x-forwarded-for")
  const origin = appOrigin()

  return makeApiClient({
    baseUrl: apiUrl(),
    cache: "no-store",
    headers: ({ method }) => {
      const h = new Headers()
      if (cookie) h.set("cookie", cookie)
      if (isTenantSlug(slug)) h.set(TENANT_HEADER, slug)
      if (method !== "GET" && origin) h.set("origin", origin)
      if (userAgent) h.set("user-agent", userAgent)
      if (forwardedFor) h.set("x-forwarded-for", forwardedFor)
      h.set("x-request-id", crypto.randomUUID())
      return h
    },
  })
}
