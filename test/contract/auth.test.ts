import { beforeEach, describe, expect, test } from "vitest"
import { z } from "zod"
import { makeApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError } from "@/lib/api/problem"
import { makeAuthClient } from "@/lib/auth-client"
import { secondFactorStep, signInStep } from "@/lib/auth-flow"
import { secretFromUri } from "@/features/account/totp-flow"
import { sessionLabel } from "../../api/src/modules/me"
import { totpCode } from "../../api/test/factories"
import { bootApi, resetDb } from "./harness"

beforeEach(resetDb)

const EMAIL = "t63@demo.example"
const PASSWORD = "Passw0rd!long-enough"
const NEW_PASSWORD = "Another!Passw0rd-2"

// T6.3 contract: the web's auth wrappers and flow decisions against the REAL API (Better Auth + the session routes), in process.
async function enrolledOwner() {
  const api = bootApi()
  const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
  const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })
  await auth.signUpEmail({ name: "T63 Tester", email: EMAIL, password: PASSWORD })
  await auth.verifyEmail(api.verificationTokenFor(EMAIL))
  await auth.signInEmail({ email: EMAIL, password: PASSWORD })
  await client.post("/v1/tenants", { body: { name: "Coppers", slug: "coppers" } })
  api.useTenant("coppers")
  // the workspace requires two-step verification for everyone (AC-M0-02)
  const enabled = await auth.enableTotp(PASSWORD)
  const secret = secretFromUri(enabled.totpURI)!
  await auth.verifyTotp(await totpCode(secret))
  await client.put("/v1/settings/mfa-policy", { body: { mode: "all", roles: [] } })
  return { api, auth, client, secret, backupCodes: enabled.backupCodes }
}

describe("T6.3 contract: sign-in, MFA enrol and verify, sign-out through lib/auth-client against the real API", () => {
  test("tenant routes answer 401 mfa_challenge for an enrolled session until the code is verified; the flow decisions map the real answers", async () => {
    const { api, auth, client, secret } = await enrolledOwner()
    await auth.signOut()
    expect([...api.jar.keys()].some((k) => /session_token$/.test(k))).toBe(false)

    // password step: the real API answers twoFactorRedirect, and signInStep says "mfa"
    expect(await signInStep({ signInEmail: auth.signInEmail }, { email: EMAIL, password: PASSWORD })).toEqual({ kind: "mfa" })
    // no session yet: a tenant route is a plain 401, not an MFA state
    const noSession = await client.get("/v1/me/tenant").catch((e: unknown) => e)
    expect(classifyApiError(noSession).kind).toBe("session_expired")

    // a wrong code is the one generic message, the right one completes the session
    expect(await secondFactorStep(auth, "totp", "000000")).toEqual({ ok: false, message: "That code is not right. Try again." })
    expect(await secondFactorStep(auth, "totp", await totpCode(secret))).toEqual({ ok: true })
    const tenant = await client.get("/v1/me/tenant")
    expect(tenant.member.role).toMatchObject({ home: "manager", access: { settings: "write" } })
  })

  test("a session that has NOT passed the code gets 401 mfa_challenge on tenant routes; classifyApiError maps it to the MFA kind; /v1/me stays reachable", async () => {
    const { api, auth, client, secret } = await enrolledOwner()
    // a second browser: password only (twoFactorRedirect), then pretend it is stepped-up later
    await auth.signOut()
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    // Better Auth gives no session until the code: so use the enrolment-time session shape instead: a fresh sign-in with 2FA plus a session row without mfa_passed
    const { ownerQuery } = await import("../../api/test/db")
    await auth.verifyTotp(await totpCode(secret))
    await ownerQuery("update session set mfa_passed = false")
    const challenged = await client.get("/v1/me/tenant").catch((e: unknown) => e)
    expect(challenged).toBeInstanceOf(ApiError)
    expect(challenged).toMatchObject({ status: 401, code: "mfa_challenge" })
    expect(classifyApiError(challenged).kind).toBe("mfa_challenge")
    expect((await client.get("/v1/me")).user.twoFactorEnabled).toBe(true)
    // the step-up verifies on the existing session, and the tenant route opens
    expect(await secondFactorStep(auth, "totp", await totpCode(secret))).toEqual({ ok: true })
    expect((await client.get("/v1/me/tenant")).tenant.slug).toBe("coppers")
    void api
  })

  test("a backup code completes the sign-in and works once", async () => {
    const { auth, client, backupCodes } = await enrolledOwner()
    await auth.signOut()
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    expect(await secondFactorStep(auth, "backup", backupCodes[0])).toEqual({ ok: true })
    expect((await client.get("/v1/me")).user.email).toBe(EMAIL)
    await auth.signOut()
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    expect(await secondFactorStep(auth, "backup", backupCodes[0])).toMatchObject({ ok: false }) // used
  })

  test("sign-out clears the session cookie and the old cookie fails closed on the next request", async () => {
    const { api, auth, client } = await enrolledOwner()
    const sessionCookie = [...api.jar].find(([k]) => /session_token$/.test(k))!
    await auth.signOut()
    const replay = await api.raw("GET", "/v1/me", { cookie: `${sessionCookie[0]}=${sessionCookie[1]}` })
    expect(replay.status).toBe(401)
    expect(classifyApiError(await client.get("/v1/me").catch((e: unknown) => e)).kind).toBe("session_expired")
  })
})

describe("T6.3 contract: sessions, providers, verification and reset against the real API", () => {
  test("GET /v1/me/sessions lists device labels without a token, DELETE removes another session, revoke-other-sessions ends the rest, list-sessions' token never appears", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })
    await auth.signUpEmail({ name: "Sess Tester", email: EMAIL, password: PASSWORD })
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    const mine = [...api.jar].map(([k, v]) => `${k}=${v}`).join("; ")
    for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"]) {
      const r = await api.raw("POST", "/api/auth/sign-in/email", { body: { email: EMAIL, password: PASSWORD }, headers: { origin: api.origin, "user-agent": ua } })
      expect(r.status).toBe(200)
    }
    const { items } = await client.get("/v1/me/sessions")
    expect(items).toHaveLength(3)
    expect(items.filter((i) => i.current)).toHaveLength(1)
    expect(items.map((i) => i.label).sort()).toEqual(["Edge on Windows", "Safari on iOS", sessionLabel(null)].sort())
    expect(JSON.stringify(items)).not.toMatch(/token|ip/i)

    const other = items.find((i) => !i.current)!
    await client.delete("/v1/me/sessions/{id}", { path: { id: other.id } })
    expect((await client.get("/v1/me/sessions")).items).toHaveLength(2)
    await auth.revokeOtherSessions()
    expect((await client.get("/v1/me/sessions")).items).toEqual([expect.objectContaining({ current: true })])
    expect((await api.raw("GET", "/v1/me", { cookie: mine })).status).toBe(200) // this session survives
  })

  test("GET /v1/auth/providers needs no session and matches its schema", async () => {
    const api = bootApi()
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })
    expect(z.object({ google: z.boolean(), microsoft: z.boolean() }).strict().parse(await client.get("/v1/auth/providers"))).toEqual({ google: false, microsoft: false })
  })

  test("password reset through lib/auth-client: the mail link carries a token that works once and revokes every session; an unknown address looks the same", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })
    await auth.signUpEmail({ name: "Reset Tester", email: EMAIL, password: PASSWORD })
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    const before = api.mailer.sent.length
    await auth.requestPasswordReset("nobody@demo.example", "/reset-password")
    expect(api.mailer.sent.length).toBe(before) // unknown address: no mail, same answer
    await auth.requestPasswordReset(EMAIL, "/reset-password")
    expect(api.mailer.sent.length).toBe(before + 1)
    const token = api.mailer.last().text.match(/\/reset-password\?token=([^\s&]+)/)![1]
    await auth.resetPassword(token, NEW_PASSWORD)
    expect(classifyApiError(await client.get("/v1/me").catch((e: unknown) => e)).kind).toBe("session_expired") // every session ended
    const again = await auth.resetPassword(token, "Third!Passw0rd-3").catch((e: unknown) => e)
    expect(again).toMatchObject({ status: 400 })
    expect(await signInStep({ signInEmail: auth.signInEmail }, { email: EMAIL, password: PASSWORD })).toEqual({ kind: "error", message: "Wrong email or password." })
    expect(await signInStep({ signInEmail: auth.signInEmail }, { email: EMAIL, password: NEW_PASSWORD })).toEqual({ kind: "signed_in" })
  })

  test("an unknown email and a wrong password are indistinguishable to signInStep; an unverified account says so", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
    await auth.signUpEmail({ name: "Enum Tester", email: EMAIL, password: PASSWORD })
    const unverified = await signInStep({ signInEmail: auth.signInEmail }, { email: EMAIL, password: PASSWORD })
    expect(unverified).toEqual({ kind: "unverified" })
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    const wrongPassword = await signInStep({ signInEmail: auth.signInEmail }, { email: EMAIL, password: "not-the-password-1" })
    const unknownEmail = await signInStep({ signInEmail: auth.signInEmail }, { email: "ghost@demo.example", password: "not-the-password-1" })
    expect(wrongPassword).toEqual({ kind: "error", message: "Wrong email or password." })
    expect(unknownEmail).toEqual(wrongPassword)
  })
})
