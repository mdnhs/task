import { describe, expect, test, vi } from "vitest"
import { makeAuthClient } from "@/lib/auth-client"
import { ApiError } from "@/lib/api/problem"

function client(res: () => Response = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) {
  const fetchMock = vi.fn(async () => res())
  const c = makeAuthClient({ baseUrl: "/api/auth", fetch: fetchMock as never })
  const last = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
    return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init.headers), credentials: init.credentials }
  }
  return { c, last, fetchMock }
}

describe("T6.3 the Better Auth wrappers: paths and bodies (pinned against the real API by test/contract)", () => {
  test("revokeOtherSessions posts to /revoke-other-sessions", async () => {
    const { c, last } = client()
    await c.revokeOtherSessions()
    expect(last()).toMatchObject({ url: "/api/auth/revoke-other-sessions", method: "POST", body: {} })
  })

  test("sign-in, the code steps, password reset and verification use the documented endpoints and never put secrets in a URL", async () => {
    const { c, last } = client()
    await c.signInEmail({ email: "a@x.ie", password: "pw-pw-pw-1" })
    expect(last()).toMatchObject({ url: "/api/auth/sign-in/email", method: "POST", body: { email: "a@x.ie", password: "pw-pw-pw-1" }, credentials: "same-origin" })
    await c.verifyTotp("123456", { trustDevice: false })
    expect(last()).toMatchObject({ url: "/api/auth/two-factor/verify-totp", body: { code: "123456", trustDevice: false } })
    await c.verifyBackupCode("abcd-efgh")
    expect(last()).toMatchObject({ url: "/api/auth/two-factor/verify-backup-code", body: { code: "abcd-efgh" } })
    await c.requestPasswordReset("a@x.ie", "/reset-password")
    expect(last()).toMatchObject({ url: "/api/auth/request-password-reset", body: { email: "a@x.ie", redirectTo: "/reset-password" } })
    await c.resetPassword("tok", "New-Passw0rd!")
    const reset = last()
    expect(reset).toMatchObject({ url: "/api/auth/reset-password", method: "POST", body: { token: "tok", newPassword: "New-Passw0rd!" } })
    expect(reset.url).not.toContain("tok") // the token and the new password travel in the body, not the URL
    await c.resendVerification("a@x.ie")
    expect(last()).toMatchObject({ url: "/api/auth/send-verification-email", body: { email: "a@x.ie" } })
    await c.verifyEmail("a b+c")
    expect(last()).toMatchObject({ url: "/api/auth/verify-email?token=a%20b%2Bc", method: "GET" })
  })

  test("a failed call is an ApiError carrying only the status, code and request id", async () => {
    const { c } = client(() => new Response(JSON.stringify({ code: "invalid_email_or_password", message: "Invalid email or password", requestId: "r1" }), { status: 401, headers: { "content-type": "application/problem+json" } }))
    await expect(c.signInEmail({ email: "a@x.ie", password: "x" })).rejects.toMatchObject({ status: 401, code: "invalid_email_or_password", requestId: "r1" })
    await c.signInEmail({ email: "a@x.ie", password: "x" }).catch((e: ApiError) => expect(JSON.stringify(e)).not.toContain("Invalid email or password"))
  })

  test("twoFactorRedirect comes through; a normal sign-in is {}", async () => {
    const two = client(() => new Response(JSON.stringify({ twoFactorRedirect: true }), { status: 200, headers: { "content-type": "application/json" } }))
    expect(await two.c.signInEmail({ email: "a@x.ie", password: "x" })).toEqual({ twoFactorRedirect: true })
    expect(await client().c.signInEmail({ email: "a@x.ie", password: "x" })).toEqual({})
  })

  test("enableTotp returns the secret link and the backup codes (shown once, never stored by the client)", async () => {
    const { c } = client(() => new Response(JSON.stringify({ totpURI: "otpauth://totp/OpsDesk:a%40x.ie?secret=JBSWY3DPEHPK3PXP&issuer=OpsDesk", backupCodes: ["aaaa-bbbb"] }), { status: 200, headers: { "content-type": "application/json" } }))
    expect(await c.enableTotp("pw")).toMatchObject({ backupCodes: ["aaaa-bbbb"] })
  })

  test("signInSocial posts the provider and a relative callback, and only an http(s) provider URL is returned", async () => {
    const good = client(() => new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", redirect: true }), { status: 200, headers: { "content-type": "application/json" } }))
    expect(await good.c.signInSocial("google", "/api/session/tenant?next=%2F")).toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" })
    expect(good.last()).toMatchObject({ url: "/api/auth/sign-in/social", method: "POST", body: { provider: "google", callbackURL: "/api/session/tenant?next=%2F" } })
    for (const url of ["javascript:alert(1)", "data:text/html,x", "not a url"]) {
      const bad = client(() => new Response(JSON.stringify({ url }), { status: 200, headers: { "content-type": "application/json" } }))
      await expect(bad.c.signInSocial("google", "/")).rejects.toMatchObject({ status: 502 })
    }
  })
})

describe("T6.5 updateName", () => {
  test("posts the new display name to /update-user (pinned against the real API in test/contract/settings.test.ts)", async () => {
    const { c, last } = client()
    await c.updateName("Ada Byrne")
    expect(last()).toMatchObject({ url: "/api/auth/update-user", method: "POST", body: { name: "Ada Byrne" } })
  })
})
