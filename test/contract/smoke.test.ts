import { beforeEach, describe, expect, test } from "vitest"
import { z } from "zod"
import { makeApiClient } from "@/lib/api/client"
import { ApiError, classifyApiError } from "@/lib/api/problem"
import { makeAuthClient } from "@/lib/auth-client"
import { EntitlementsDto } from "../../api/src/modules/entitlements/routes"
import { MeDto, MeTenantDto } from "../../api/src/modules/tenants/routes"
import { bootApi, resetDb } from "./harness"

beforeEach(resetDb)

const EMAIL = "contract@demo.example"
const PASSWORD = "Passw0rd!long-enough"

/** Parses with the route's schema AND checks the top level has no key the schema does not know (the schemas are not strict by default). */
function parseStrictTop<S extends z.ZodObject<z.ZodRawShape>>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.parse(body)
  expect(Object.keys(body as object).sort()).toEqual(Object.keys(schema.shape).sort())
  return parsed
}

describe("contract smoke (real API, in process)", () => {
  test("makeApiClient with fetch = app.request: sign up, verify through the captured mail, sign in, GET /v1/me, create a tenant, GET /v1/me/tenant and /v1/entitlements all parse against their zod schemas", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })

    await auth.signUpEmail({ name: "Contract Tester", email: EMAIL, password: PASSWORD })
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    const signedIn = await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    expect(signedIn.twoFactorRedirect).toBeUndefined()
    expect([...api.jar.keys()].some((k) => /better-auth\.session_token$/.test(k))).toBe(true)

    const me = parseStrictTop(MeDto, await client.get("/v1/me"))
    expect(me.user).toMatchObject({ email: EMAIL, name: "Contract Tester", emailVerified: true, twoFactorEnabled: false })
    expect(me.platformRole).toBeNull()
    expect(me.tenants).toEqual([])

    const created = await client.post("/v1/tenants", { body: { name: "Coppers", slug: "coppers" } })
    expect(created).toMatchObject({ slug: "coppers" })

    const after = parseStrictTop(MeDto, await client.get("/v1/me"))
    expect(after.tenants).toEqual([{ slug: "coppers", name: "Coppers", roleKey: "owner" }])

    api.useTenant("coppers")
    const tenant = parseStrictTop(MeTenantDto, await client.get("/v1/me/tenant"))
    expect(tenant.tenant).toMatchObject({ slug: "coppers", name: "Coppers", timezone: "Europe/Dublin" })
    expect(tenant.member.roleKey).toBe("owner")
    expect(tenant.device).toEqual({ id: null, type: "browser", label: "Unregistered browser", trusted: false })
    expect(typeof tenant.features.drive).toBe("boolean")

    const ent = EntitlementsDto.parse(await client.get("/v1/entitlements"))
    expect(typeof ent.planId).toBe("string")
  })

  test("a refused call becomes an ApiError that classifyApiError understands (tenant-less call, wrong tenant, no session)", async () => {
    const api = bootApi()
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch })
    const noSession = await client.get("/v1/me").catch((e: unknown) => e)
    expect(noSession).toBeInstanceOf(ApiError)
    expect(classifyApiError(noSession).kind).toBe("session_expired")
    const noTenant = await client.get("/v1/entitlements").catch((e: unknown) => e)
    expect((noTenant as ApiError).status).toBe(400)
    expect(classifyApiError(noTenant).kind).toBe("validation")
  })

  test("a foreign Origin on a state-changing call is refused by the real API (requireSameOrigin)", async () => {
    const api = bootApi()
    const client = makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch, headers: async () => new Headers({ origin: "https://evil.example" }) })
    const e = await client.post("/v1/tenants", { body: { name: "X", slug: "xx-co" } }).catch((x: unknown) => x)
    expect(e).toMatchObject({ status: 403, code: "bad_origin" })
  })

  test("lib/auth-client wrappers match the real Better Auth paths and bodies: sign-up, sign-in, verify-email, forgot/reset password, two-factor enable/verify, sign-out", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })

    await auth.signUpEmail({ name: "Auth Tester", email: EMAIL, password: PASSWORD })
    // the unverified account is refused with the code the UI maps to "Verify your email"
    const unverified = await auth.signInEmail({ email: EMAIL, password: PASSWORD }).catch((e: unknown) => e)
    expect(classifyApiError(unverified).kind).toBe("email_not_verified")
    await auth.resendVerification(EMAIL)
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })

    // two-factor: enable (password) -> secret + backup codes, then verify the first code
    const enabled = await auth.enableTotp(PASSWORD)
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(enabled.backupCodes.length).toBeGreaterThan(3)
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!
    const { totpCode } = await import("../../api/test/factories")
    await auth.verifyTotp(await totpCode(secret))
    const uri = await auth.getTotpUri(PASSWORD)
    expect(uri.totpURI).toMatch(/^otpauth:\/\//)

    // the paths of forgot and reset password are real endpoints (the mail flow itself arrives with T6.3): never a 404
    const forgot = await auth.requestPasswordReset("nobody@demo.example", "/reset-password").catch((e: unknown) => e)
    const reset = await auth.resetPassword("not-a-token", "Another-Passw0rd!x").catch((e: unknown) => e)
    for (const r of [forgot, reset]) if (r instanceof ApiError) expect(r.status, r.code).not.toBe(404)

    // a wrong code is a typed failure, not a crash
    const bad = await auth.verifyBackupCode("definitely-wrong").catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(ApiError)

    await auth.signOut()
    expect([...api.jar.keys()].some((k) => /better-auth\.session_token$/.test(k))).toBe(false)
    const after = await makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch }).get("/v1/me").catch((e: unknown) => e)
    expect(classifyApiError(after).kind).toBe("session_expired")
  })

  test("sign-in with two-factor enabled answers { twoFactorRedirect: true } and the second step completes the session", async () => {
    const api = bootApi()
    const auth = makeAuthClient({ baseUrl: `${api.baseUrl}/api/auth`, fetch: api.fetch })
    await auth.signUpEmail({ name: "Mfa Tester", email: EMAIL, password: PASSWORD })
    await auth.verifyEmail(api.verificationTokenFor(EMAIL))
    await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    const enabled = await auth.enableTotp(PASSWORD)
    const { totpCode } = await import("../../api/test/factories")
    const secret = new URL(enabled.totpURI).searchParams.get("secret")!
    await auth.verifyTotp(await totpCode(secret))
    await auth.signOut()
    const step1 = await auth.signInEmail({ email: EMAIL, password: PASSWORD })
    expect(step1.twoFactorRedirect).toBe(true)
    await auth.verifyBackupCode(enabled.backupCodes[0])
    const me = parseStrictTop(MeDto, await makeApiClient({ baseUrl: api.baseUrl, fetch: api.fetch }).get("/v1/me"))
    expect(me.user.twoFactorEnabled).toBe(true)
  })
})
