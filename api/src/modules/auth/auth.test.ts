import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerQuery } from "../../../test/db"
import { signIn, signUp } from "../../../test/factories"
import { buildAuth } from "./auth"

type Code = { code: string }
const EMAIL = "a@x.ie"
const PW = "Passw0rd!long"

beforeEach(resetDb)

async function signedIn() {
  const t = testApp()
  expect((await signUp(t.app, EMAIL, PW, "A")).status).toBe(200)
  const { cookie } = await signIn(t.app, EMAIL, PW)
  return { ...t, cookie }
}

test("sign-up then sign-in returns a session cookie and /v1/me works", async () => {
  const { app, cookie } = await signedIn()
  const r = await call(app, "GET", "/v1/me", { cookie })
  expect(r.status).toBe(200)
  const body = (await r.json()) as { user: { id: string; email: string }; tenants: unknown[] }
  expect(body.user.email).toBe(EMAIL)
  expect(body.user.id).toEqual(expect.any(String))
  expect(body.tenants).toEqual([])
})
test("GET /v1/me without a cookie is 401 unauthenticated", async () => {
  const r = await call(testApp().app, "GET", "/v1/me")
  expect(r.status).toBe(401)
  expect(r.headers.get("content-type")).toMatch(/problem\+json/)
  expect(((await r.json()) as Code).code).toBe("unauthenticated")
})
test("a garbage cookie is 401 unauthenticated", async () => {
  const r = await call(testApp().app, "GET", "/v1/me", { cookie: "better-auth.session_token=nope.nope" })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Code).code).toBe("unauthenticated")
})
test("wrong password does not sign in", async () => {
  const { app } = testApp()
  await signUp(app, EMAIL, PW)
  const r = await call(app, "POST", "/api/auth/sign-in/email", {
    body: { email: EMAIL, password: "Wr0ng-password!!" },
    headers: { origin: testEnv.APP_URL },
  })
  expect(r.status).toBe(401)
  expect(r.headers.getSetCookie()).toEqual([])
})
test("session idle longer than the default 12h is 401 session_expired and the session is revoked", async () => {
  const { app, clock, cookie } = await signedIn()
  const before = await ownerQuery("select id from session") // sign-up auto-signs in too: 2 rows
  clock.advance({ hours: 12, minutes: 1 })
  const r = await call(app, "GET", "/v1/me", { cookie })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Code).code).toBe("session_expired")
  expect(await ownerQuery("select id from session")).toHaveLength(before.length - 1)
  // revoked, not just rejected once: the same cookie is now simply unauthenticated
  const again = await call(app, "GET", "/v1/me", { cookie })
  expect(again.status).toBe(401)
  expect(((await again.json()) as Code).code).toBe("unauthenticated")
})
test("idle cookie is also rejected on Better Auth's own endpoints, and the session is revoked", async () => {
  const { app, clock, cookie } = await signedIn()
  const hdr = { origin: testEnv.APP_URL }
  expect((await call(app, "GET", "/api/auth/get-session", { cookie })).status).toBe(200)
  const before = await ownerQuery("select id from session")
  clock.advance({ hours: 12, minutes: 1 })
  const g = await call(app, "GET", "/api/auth/get-session", { cookie })
  expect(g.status).toBe(401)
  expect(((await g.json()) as Code).code).toBe("session_expired")
  expect(await ownerQuery("select id from session")).toHaveLength(before.length - 1)
  const { cookie: other } = await signIn(app, EMAIL, PW)
  clock.advance({ hours: 12, minutes: 1 })
  const r = await call(app, "POST", "/api/auth/revoke-other-sessions", { cookie: other, body: {}, headers: hdr })
  expect(r.status).toBe(401)
  expect(((await r.json()) as Code).code).toBe("session_expired")
})
test("a fresh cookie works on get-session; sign-in without a session is untouched", async () => {
  const { app, cookie } = await signedIn()
  const g = await call(app, "GET", "/api/auth/get-session", { cookie })
  expect(g.status).toBe(200)
  expect(((await g.json()) as { user: { email: string } }).user.email).toBe(EMAIL)
})
test("activity inside the window keeps the session alive", async () => {
  const { app, clock, cookie } = await signedIn()
  clock.advance({ hours: 11 })
  expect((await call(app, "GET", "/v1/me", { cookie })).status).toBe(200)
  clock.advance({ hours: 11 })
  expect((await call(app, "GET", "/v1/me", { cookie })).status).toBe(200)
})
test("lastSeenAt is stored on the session row from the fake clock", async () => {
  const { app, clock, cookie } = await signedIn()
  clock.advance({ hours: 3 })
  await call(app, "GET", "/v1/me", { cookie })
  const rows = await ownerQuery("select max(last_seen_at) as last_seen_at from session")
  expect(new Date(rows[0].last_seen_at as string).toISOString()).toBe(clock.now().toISOString())
})
test("session cookie is HttpOnly, SameSite=Lax and not Secure outside production", async () => {
  const { app } = testApp()
  await signUp(app, EMAIL, PW)
  const res = await call(app, "POST", "/api/auth/sign-in/email", { body: { email: EMAIL, password: PW }, headers: { origin: testEnv.APP_URL } })
  const sc = res.headers.getSetCookie().find((c) => c.includes("session_token"))!
  expect(sc).toMatch(/HttpOnly/i)
  expect(sc).toMatch(/SameSite=Lax/i)
  expect(sc).not.toMatch(/Secure/i)
})
test("session cookie is Secure in production", async () => {
  const { app } = testApp({ env: { ...testEnv, NODE_ENV: "production" } })
  await signUp(app, EMAIL, PW)
  const res = await call(app, "POST", "/api/auth/sign-in/email", { body: { email: EMAIL, password: PW }, headers: { origin: testEnv.APP_URL } })
  const sc = res.headers.getSetCookie().find((c) => c.includes("session_token"))!
  expect(sc).toMatch(/Secure/)
  expect(sc).toMatch(/HttpOnly/i)
  expect(sc).toMatch(/SameSite=Lax/i)
})
test("a cookie-bearing state-changing request from an untrusted origin is rejected (CSRF)", async () => {
  const { app, cookie } = await signedIn()
  const r = await call(app, "POST", "/api/auth/sign-out", { cookie, body: {}, headers: { origin: "https://evil.example" } })
  expect(r.status).toBe(403)
  expect((await call(app, "GET", "/v1/me", { cookie })).status).toBe(200)
})
test("two-factor plugin is enabled", () => {
  const { deps } = testApp()
  expect(deps.auth.options.plugins?.map((p) => p.id)).toContain("two-factor")
})
test("social providers are registered only when their env vars are set", () => {
  const { deps } = testApp()
  const auth = (over: Record<string, string>) => buildAuth({ ...deps, env: { ...testEnv, ...over } })
  expect(Object.keys(auth({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" }).options.socialProviders ?? {})).toEqual(["google"])
  expect(Object.keys(auth({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" }).options.socialProviders ?? {})).toEqual([])
  expect(Object.keys(auth({ GOOGLE_CLIENT_ID: "g" }).options.socialProviders ?? {})).toEqual([])
  expect(Object.keys(auth({}).options.socialProviders ?? {})).toEqual([])
})
