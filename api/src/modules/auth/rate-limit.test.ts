import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeMember, makeTenant, roleIdOf, signIn, signUp } from "../../../test/factories"
import { RATE, hashKey } from "../../core/middleware/rate-limit"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)
const ORIGIN = { origin: testEnv.APP_URL }
const behindProxy = () => testApp({ env: { ...testEnv, TRUST_PROXY_HOPS: 1 } })
const signInFrom = (app: ReturnType<typeof testApp>["app"], xff: string | undefined, email = "nobody@example.ie") =>
  call(app, "POST", "/api/auth/sign-in/email", { body: { email, password: "wrong-password-1" }, headers: { ...ORIGIN, ...(xff ? { "x-forwarded-for": xff } : {}) } })

test("auth endpoints are limited per IP; a forged x-forwarded-for does not give a fresh bucket", async () => {
  const t = behindProxy()
  for (let i = 0; i < testEnv.AUTH_RATE_LIMIT_PER_MIN; i++) expect((await signInFrom(t.app, `10.0.${i}.1, 5.5.5.5`)).status).toBe(401)
  const r = await signInFrom(t.app, "10.99.0.1, 5.5.5.5")
  expect(r.status).toBe(429)
  expect(((await r.json()) as Json).code).toBe("rate_limited")
  expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0)
  expect((await signInFrom(t.app, "10.99.0.1, 6.6.6.6")).status).toBe(401) // another real client
  t.clock.advance({ minutes: 2 })
  expect((await signInFrom(t.app, "10.99.0.1, 5.5.5.5")).status).toBe(401) // window over
})
test("a caller-supplied x-opsdesk-client-ip header is overwritten, never read", async () => {
  const t = behindProxy()
  for (let i = 0; i < testEnv.AUTH_RATE_LIMIT_PER_MIN; i++) {
    const r = await call(t.app, "POST", "/api/auth/sign-in/email", { body: { email: "nobody@example.ie", password: "wrong-password-1" }, headers: { ...ORIGIN, "x-forwarded-for": "5.5.5.5", "x-opsdesk-client-ip": `9.9.9.${i}` } })
    expect(r.status).toBe(401)
  }
  expect((await signInFrom(t.app, "5.5.5.5")).status).toBe(429)
})
test("with TRUST_PROXY_HOPS=0 the header is ignored: callers share the socket bucket", async () => {
  const t = testApp()
  for (let i = 0; i < testEnv.AUTH_RATE_LIMIT_PER_MIN; i++) expect((await signInFrom(t.app, `7.7.${i}.1`)).status).toBe(401)
  expect((await signInFrom(t.app, "8.8.8.8")).status).toBe(429)
})
test("mail senders are limited per target address, whatever the IP; the address is not stored in the limiter", async () => {
  const t = behindProxy()
  const send = (i: number, email: string) => call(t.app, "POST", "/api/auth/request-password-reset", { body: { email }, headers: { ...ORIGIN, "x-forwarded-for": `1.1.1.${i}` } })
  for (let i = 0; i < RATE.authMailAddress.limit; i++) expect((await send(i, "victim@example.ie")).status).toBe(200)
  expect((await send(99, "victim@example.ie")).status).toBe(429)
  expect((await send(99, "Victim@Example.ie")).status).toBe(429) // case does not make a new address
  expect((await send(99, "other@example.ie")).status).toBe(200)
  expect(t.rateLimiter.hits.some((k) => k.includes("victim"))).toBe(false)
})
test("invites are limited per target address across tenants; tenant creation per user", async () => {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const admin = await makeMember(t.deps, tenant.id, "admin")
  const { cookie } = await signIn(t.app, admin.email, admin.password)
  const roleId = await roleIdOf(t.deps, tenant.id, "employee")
  const inv = () => call(t.app, "POST", "/v1/invites", { cookie, tenant: "acme", body: { email: "target@x.ie", roleId } })
  expect((await inv()).status).toBe(201)
  for (let i = 1; i < RATE.inviteMailAddress.limit; i++) await t.rateLimiter.hit(`invite-mail:${hashKey("target@x.ie")}`, RATE.inviteMailAddress) // the same address invited from other tenants
  const r = await inv()
  expect(r.status).toBe(429)
  expect(((await r.json()) as Json).code).toBe("rate_limited")
  expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0)

  await signUp(t.app, "founder@x.ie", "Passw0rd!long", "F")
  const founder = (await signIn(t.app, "founder@x.ie", "Passw0rd!long")).cookie
  const mk = (n: number) => call(t.app, "POST", "/v1/tenants", { cookie: founder, body: { name: `T${n}`, slug: `t-${n}` } })
  for (let i = 0; i < RATE.tenantCreateUser.limit; i++) expect((await mk(i)).status).toBe(201)
  expect((await mk(99)).status).toBe(429)
})
test("limiter store down: sign-in fails closed with 503", async () => {
  const t = testApp()
  t.rateLimiter.down = true
  const r = await signInFrom(t.app, undefined)
  expect([r.status, ((await r.json()) as Json).code]).toEqual([503, "rate_limit_unavailable"])
})
