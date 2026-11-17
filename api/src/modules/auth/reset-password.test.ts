import pino from "pino"
import { beforeEach, describe, expect, test } from "vitest"
import { call, fakeMailer, resetDb, testApp, testEnv } from "../../../test/harness"
import { ownerQuery } from "../../../test/db"
import { makeUser, signIn, signUp } from "../../../test/factories"
import { buildAuth } from "./auth"

const origin = { origin: testEnv.APP_URL }
const request = (app: ReturnType<typeof testApp>["app"], email: string) => call(app, "POST", "/api/auth/request-password-reset", { body: { email }, headers: origin })
const reset = (app: ReturnType<typeof testApp>["app"], token: string, newPassword: string) => call(app, "POST", "/api/auth/reset-password", { body: { token, newPassword }, headers: origin })
const tokenOf = (mail: { text: string }) => mail.text.match(/\/reset-password\?token=([^\s&]+)/)?.[1] ?? ""

beforeEach(resetDb)

describe("T6.3 password reset (I23 a)", () => {
  test("a verified user gets exactly one mail with a link to the web app; an unknown email gets the same 200 body and no mail", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    t.mailer.sent.length = 0 // sign-up sent its own verification mail
    const known = await request(t.app, u.email)
    const unknown = await request(t.app, "nobody@example.ie")
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await known.json()).toEqual(await unknown.json())
    expect(t.mailer.sent).toHaveLength(1)
    expect(t.mailer.last().to).toBe(u.email)
    expect(t.mailer.last().text).toContain(`${testEnv.APP_URL}/reset-password?token=`)
    expect(tokenOf(t.mailer.last())).not.toBe("")
  })

  test("an unverified account gets the same 200 and no mail (it has a verification mail instead)", async () => {
    const t = testApp()
    await signUp(t.app, "unv@x.ie", "Passw0rd!long", "U", { verify: false })
    t.mailer.sent.length = 0
    const r = await request(t.app, "unv@x.ie")
    expect(r.status).toBe(200)
    expect(t.mailer.sent).toHaveLength(0)
  })

  test("the token works once: the new password signs in, the old one does not, a second use is 400 invalid_token", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    await request(t.app, u.email)
    const token = tokenOf(t.mailer.last())
    const ok = await reset(t.app, token, "Another!Passw0rd")
    expect(ok.status).toBe(200)
    await expect(signIn(t.app, u.email, u.password)).rejects.toThrow(/401|400/)
    expect((await signIn(t.app, u.email, "Another!Passw0rd")).cookie).toBeTruthy()
    const again = await reset(t.app, token, "Third!Passw0rd1")
    expect(again.status).toBe(400)
    expect(await again.json()).toMatchObject({ code: "invalid_token" })
  })

  test("the token lifetime is one hour, and an expired token is refused", async () => {
    const t = testApp()
    expect(t.deps.auth.options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(3600)
    const u = await makeUser(t.deps)
    await request(t.app, u.email)
    const token = tokenOf(t.mailer.last())
    await ownerQuery("update verification set expires_at = now() - interval '1 minute' where identifier = $1", [`reset-password:${token}`])
    const r = await reset(t.app, token, "Another!Passw0rd")
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ code: "invalid_token" })
    expect((await signIn(t.app, u.email, u.password)).cookie).toBeTruthy() // password unchanged
  })

  test("a reset revokes every existing session of the user", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    const { cookie } = await signIn(t.app, u.email, u.password)
    expect((await call(t.app, "GET", "/v1/me", { cookie })).status).toBe(200)
    await request(t.app, u.email)
    expect((await reset(t.app, tokenOf(t.mailer.last()), "Another!Passw0rd")).status).toBe(200)
    expect((await call(t.app, "GET", "/v1/me", { cookie })).status).toBe(401)
    expect(await ownerQuery("select id from session")).toEqual([])
  })

  test("a too-short new password is refused and the token stays usable", async () => {
    const t = testApp()
    const u = await makeUser(t.deps)
    await request(t.app, u.email)
    const token = tokenOf(t.mailer.last())
    expect((await reset(t.app, token, "short")).status).toBe(400)
    expect((await reset(t.app, token, "Another!Passw0rd")).status).toBe(200)
  })

  test("the production config: reset mail via the mailer, sessions revoked on reset", () => {
    const { deps } = testApp()
    expect(typeof deps.auth.options.emailAndPassword?.sendResetPassword).toBe("function")
    expect(deps.auth.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true)
  })

  test("a failing mailer does not change the answer and the token, link and address never reach the logs", async () => {
    const lines: string[] = []
    const logger = pino({ level: "debug" }, { write: (l: string) => void lines.push(l) })
    const { deps } = testApp()
    const u = await makeUser(deps)
    const mailer = { send: async () => { throw new Error(`smtp down for ${u.email}`) } }
    const { app } = testApp({ auth: buildAuth({ ...deps, mailer, logger }), mailer, logger })
    lines.length = 0
    const r = await request(app, u.email)
    expect(r.status).toBe(200)
    await new Promise((res) => setTimeout(res, 30))
    const all = lines.join("\n")
    expect(all).toContain("password reset email send failed")
    expect(all).not.toMatch(/reset-password|token=/i)
    expect(all).not.toContain(u.email)
    const row = (await ownerQuery("select identifier from verification where identifier like 'reset-password:%'"))[0]
    expect(all).not.toContain(String(row.identifier).slice("reset-password:".length))
  })

  test("the request returns before the mail is sent (no timing difference between a known and an unknown address)", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const mailer = { send: async () => { await gate } }
    const { deps } = testApp()
    const u = await makeUser(deps)
    const auth = buildAuth({ ...deps, mailer })
    const { app } = testApp({ auth, mailer })
    const r = await Promise.race([request(app, u.email), new Promise<"slow">((res) => setTimeout(() => res("slow"), 1500))])
    release()
    expect(r).not.toBe("slow")
  })
})
