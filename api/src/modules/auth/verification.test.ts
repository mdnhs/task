import pino from "pino"
import { beforeEach, expect, test } from "vitest"
import { call, fakeMailer, resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerQuery } from "../../../test/db"
import { signIn, signUp, verificationToken, verifyEmail } from "../../../test/factories"
import { buildAuth } from "./auth"

const EMAIL = "v@x.ie"
const PW = "Passw0rd!long"
const origin = { origin: testEnv.APP_URL }
const signInRaw = (app: ReturnType<typeof testApp>["app"], email = EMAIL, password = PW) =>
  call(app, "POST", "/api/auth/sign-in/email", { body: { email, password }, headers: origin })

beforeEach(resetDb)

test("sign-up sends one verification email to the address", async () => {
  const { app, mailer } = testApp()
  const r = await signUp(app, EMAIL, PW, "V", { verify: false })
  expect(r.status).toBe(200)
  expect(r.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false)
  expect(mailer.sent).toHaveLength(1)
  expect(mailer.last().to).toBe(EMAIL)
  expect(mailer.last().text).toContain(`${testEnv.APP_URL}/verify-email?token=`)
})
test("sign-in before verification is 403 email_not_verified", async () => {
  const { app } = testApp()
  await signUp(app, EMAIL, PW, "V", { verify: false })
  const r = await signInRaw(app)
  expect(r.status).toBe(403)
  expect(r.headers.get("content-type")).toMatch(/problem\+json/)
  expect(await r.json()).toMatchObject({ status: 403, code: "email_not_verified", requestId: expect.any(String) })
  expect(r.headers.getSetCookie()).toEqual([])
  expect(await ownerQuery("select id from session")).toEqual([])
})
test("following the verification link then signing in succeeds", async () => {
  const { app } = testApp()
  await signUp(app, EMAIL, PW, "V", { verify: false })
  const v = await verifyEmail(app, verificationToken(app, EMAIL))
  expect(v.status).toBe(200)
  // autoSignInAfterVerification is false: verifying alone creates no session
  expect(v.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false)
  expect(await ownerQuery("select email_verified from \"user\"")).toEqual([{ email_verified: true }])
  const { cookie } = await signIn(app, EMAIL, PW)
  expect((await call(app, "GET", "/v1/me", { cookie })).status).toBe(200)
})
test("expired verification token does not verify", async () => {
  // Better Auth signs the token with a real-time JWT exp and ignores deps.clock,
  // so this one test uses a 1s token lifetime and waits it out.
  const { deps } = testApp()
  const mailer = fakeMailer()
  const auth = buildAuth({ ...deps, mailer }, { verificationTtlSeconds: 1 })
  const { app } = testApp({ auth, mailer })
  await signUp(app, EMAIL, PW, "V", { verify: false })
  const token = verificationToken(app, EMAIL)
  await new Promise((r) => setTimeout(r, 2100))
  const v = await verifyEmail(app, token)
  expect(v.status).toBeGreaterThanOrEqual(400)
  expect(await ownerQuery("select email_verified from \"user\"")).toEqual([{ email_verified: false }])
  expect((await signInRaw(app)).status).toBe(403)
})
test("the production verification token lifetime is 24 hours", () => {
  const { deps } = testApp()
  expect(deps.auth.options.emailVerification?.expiresIn).toBe(86400)
  expect(deps.auth.options.emailVerification?.autoSignInAfterVerification).toBe(false)
  expect(deps.auth.options.emailAndPassword?.requireEmailVerification).toBe(true)
})
test("resend verification sends a new email", async () => {
  const { app, mailer } = testApp()
  await signUp(app, EMAIL, PW, "V", { verify: false })
  const r = await call(app, "POST", "/api/auth/send-verification-email", { body: { email: EMAIL }, headers: origin })
  expect(r.status).toBe(200)
  expect(mailer.sent).toHaveLength(2)
  expect(mailer.sent.every((m) => m.to === EMAIL)).toBe(true)
})
test("social-provider accounts are not blocked by email verification config", () => {
  // Better Auth marks provider accounts verified from the provider's email_verified claim;
  // we only assert providers are wired and requireEmailVerification stays scoped to password sign-in.
  const { deps } = testApp()
  const auth = buildAuth({ ...deps, env: { ...testEnv, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" } })
  expect(Object.keys(auth.options.socialProviders ?? {})).toEqual(["google"])
  expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(true)
})
test("cookieless sign-in from an untrusted origin is 403 (login CSRF)", async () => {
  const { app } = testApp()
  await signUp(app, EMAIL, PW)
  const r = await call(app, "POST", "/api/auth/sign-in/email", {
    body: { email: EMAIL, password: PW },
    headers: { origin: "https://evil.example" },
  })
  expect(r.status).toBe(403)
  expect(r.headers.getSetCookie()).toEqual([])
})
test("a failing mailer does not fail sign-up; the error is logged without the token", async () => {
  const lines: string[] = []
  const logger = pino({ level: "error" }, { write: (l: string) => void lines.push(l) })
  const mailer = { send: async () => { throw new Error("smtp down") } }
  const { deps } = testApp()
  const auth = buildAuth({ ...deps, mailer, logger })
  const { app } = testApp({ auth, mailer, logger })
  const r = await signUp(app, EMAIL, PW, "V", { verify: false })
  expect(r.status).toBe(200)
  await new Promise((res) => setTimeout(res, 20))
  expect(lines).toHaveLength(1)
  const entry = JSON.parse(lines[0]) as { msg: string; userId: string }
  expect(entry.msg).toBe("verification email send failed")
  expect(entry.userId).toEqual(expect.any(String))
  expect(lines[0]).not.toMatch(/token|verify-email/i)
})
