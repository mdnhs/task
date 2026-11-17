import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeApiKey, makeMember, makeTenant, signIn } from "../../../test/factories"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const { cookie } = await signIn(t.app, owner.email, owner.password)
  let n = 0
  /** A cookie-bearing state-changing request (POST /v1/tenants with a fresh slug each time) with the given headers. */
  const post = (headers: Record<string, string>, over: { cookie?: string | null } = {}) =>
    call(t.app, "POST", "/v1/tenants", { cookie: over.cookie === null ? undefined : (over.cookie ?? cookie), body: { name: "Co", slug: `co-${++n}` }, headers })
  return { ...t, tenant, owner, cookie, post }
}

describe("requireSameOrigin (I6 layer 2)", () => {
  test("a cookie POST with a foreign Origin is 403 bad_origin (problem+json, nothing written); the same Origin and no Origin pass", async () => {
    const w = await world()
    const bad = await w.post({ origin: "https://evil.example" })
    expect(bad.status).toBe(403)
    expect(bad.headers.get("content-type")).toMatch(/problem\+json/)
    expect(((await bad.json()) as Json).code).toBe("bad_origin")
    expect((await w.post({ origin: testEnv.APP_URL })).status).toBe(201)
    expect((await w.post({})).status).toBe(201)
  })

  test("a foreign Origin is refused before authentication: no session, still 403 (not 401)", async () => {
    const w = await world()
    const r = await w.post({ origin: "https://evil.example" }, { cookie: null })
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json).code).toBe("bad_origin")
  })

  test("only an exact origin match passes: sibling subdomain, other port, other scheme, suffix trick and the literal null origin are all 403", async () => {
    const w = await world()
    for (const origin of ["http://evil.localhost:3000", "http://localhost:3001", "https://localhost:3000", "http://localhost:3000.evil.example", "null", "http://localhost", "not a url"]) {
      const r = await w.post({ origin })
      expect(r.status, origin).toBe(403)
      expect(((await r.json()) as Json).code, origin).toBe("bad_origin")
    }
  })

  test("a path or trailing slash on the Origin is not an origin: only scheme://host[:port] equal to APP_URL passes", async () => {
    const w = await world()
    expect((await w.post({ origin: `${testEnv.APP_URL}/` })).status).toBe(403)
    expect((await w.post({ origin: `${testEnv.APP_URL}/x` })).status).toBe(403)
  })

  test("PUT, PATCH and DELETE are checked too", async () => {
    const w = await world()
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const r = await call(w.app, method, "/v1/anything", { cookie: w.cookie, headers: { origin: "https://evil.example" } })
      expect(r.status, method).toBe(403)
      expect(((await r.json()) as Json).code, method).toBe("bad_origin")
    }
  })

  test("GET is never checked: a foreign Origin on GET /v1/me still answers", async () => {
    const w = await world()
    const r = await call(w.app, "GET", "/v1/me", { cookie: w.cookie, headers: { origin: "https://evil.example" } })
    expect(r.status).toBe(200)
  })

  test("a Bearer odk_ API key is exempt (no cookie, no CSRF): a foreign Origin is not refused as bad_origin", async () => {
    const w = await world()
    const { key } = await makeApiKey(w.deps, w.tenant.id, w.owner.userId, ["tasks:write"])
    const r = await call(w.app, "POST", "/v1/tasks", { headers: { authorization: `Bearer ${key}`, origin: "https://evil.example" }, body: {} })
    expect(((await r.json()) as Json).code).not.toBe("bad_origin")
  })

  test("a Bearer header that is not an odk_ key does not buy the exemption", async () => {
    const w = await world()
    const r = await call(w.app, "POST", "/v1/tenants", { cookie: w.cookie, headers: { authorization: "Bearer not-a-key", origin: "https://evil.example" }, body: { name: "Co", slug: "co-x" } })
    expect(r.status).toBe(403)
    expect(((await r.json()) as Json).code).toBe("bad_origin")
  })

  test("outside /v1 nothing changes: the Stripe webhook keeps its own signature check", async () => {
    const w = await world()
    const hook = await call(w.app, "POST", "/webhooks/billing/stripe", { headers: { origin: "https://evil.example" }, body: {} })
    expect(((await hook.json().catch(() => ({}))) as Json).code).not.toBe("bad_origin")
  })
})
