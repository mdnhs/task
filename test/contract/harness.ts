// Contract harness (B6 ruling I29): boots the REAL API in-process (api/test/harness: Testcontainers Postgres, Redis and MinIO from
// api/test/global-setup.ts) and exposes it as a `fetch`, so the web's ApiClient and auth client run against the real routes.
// Responses are validated with the route's own zod schema by the tests, then (in later tasks) handed to the real adapter.
import { call, resetDb, testApp, testEnv } from "../../api/test/harness"
import { verificationToken } from "../../api/test/factories"

export { resetDb, testEnv }

export type Booted = ReturnType<typeof bootApi>

/** The API app plus a cookie jar and a `fetch` that behaves like a browser on the web origin (APP_URL): it replays Set-Cookie and sends Origin. */
export function bootApi() {
  const t = testApp()
  const origin = testEnv.APP_URL
  const jar = new Map<string, string>()
  const state = { tenant: null as string | null }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const headers = new Headers(init?.headers)
    if (!headers.has("origin") && (init?.method ?? "GET") !== "GET") headers.set("origin", origin)
    if (jar.size > 0 && !headers.has("cookie")) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "))
    if (state.tenant && !headers.has("x-tenant")) headers.set("x-tenant", state.tenant)
    const res = await t.app.request(url.pathname + url.search, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | undefined })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (value === "" || /max-age=0/i.test(c)) jar.delete(name)
      else jar.set(name, value)
    }
    return res
  }

  return {
    ...t,
    origin,
    jar,
    fetch,
    baseUrl: "http://api.test",
    /** Acts as the BFF does for a tenant route: X-Tenant from the active tenant (the real BFF derives it from the od-tenant cookie). */
    useTenant: (slug: string | null) => void (state.tenant = slug),
    /** The newest verification token the fake mailer captured for `email`. */
    verificationTokenFor: (email: string) => verificationToken(t.app, email),
    raw: (method: string, path: string, o: Parameters<typeof call>[3] = {}) => call(t.app, method, path, o),
  }
}
