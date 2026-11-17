import { describe, expect, test, vi } from "vitest"
import { ApiError } from "@/lib/api/problem"
import { confirmEnrolment, disableTotpFlow, formatSecret, otpauthHref, secretFromUri, startEnrolment } from "./totp-flow"

const URI = "otpauth://totp/OpsDesk:ana%40x.ie?secret=JBSWY3DPEHPK3PXP&issuer=OpsDesk&algorithm=SHA1&digits=6&period=30"
const problem = (status: number, code: string) => new ApiError(status, code, "req-1")

describe("T6.3 TOTP set-up without a QR (ruling J1): the secret and the otpauth link only", () => {
  test("the secret is read from the otpauth link and shown in groups of four", () => {
    expect(secretFromUri(URI)).toBe("JBSWY3DPEHPK3PXP")
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP")
    expect(secretFromUri("otpauth://totp/x")).toBeNull()
    expect(secretFromUri("not a url")).toBeNull()
  })

  test("only an otpauth: link becomes an href (a hostile scheme from a tampered response is dropped)", () => {
    expect(otpauthHref(URI)).toBe(URI)
    for (const bad of ["javascript:alert(1)", "https://evil.example/otpauth://x", "data:text/html,x", "OTPAUTH-evil://x", ""]) expect(otpauthHref(bad), bad).toBeNull()
  })

  test("startEnrolment returns the secret, the link and the backup codes; a wrong password is one generic message", async () => {
    const enable = vi.fn(async () => ({ totpURI: URI, backupCodes: ["aaaa-bbbb", "cccc-dddd"] }))
    const ok = await startEnrolment({ enable, verify: vi.fn() }, "pw")
    expect(ok).toEqual({ ok: true, secret: "JBSW Y3DP EHPK 3PXP", uri: URI, backupCodes: ["aaaa-bbbb", "cccc-dddd"] })
    const bad = await startEnrolment({ enable: async () => { throw problem(400, "invalid_password") }, verify: vi.fn() }, "nope")
    expect(bad).toEqual({ ok: false, message: "That password is not right." })
    const limited = await startEnrolment({ enable: async () => { throw problem(429, "too_many_requests") }, verify: vi.fn() }, "x")
    expect(limited).toMatchObject({ ok: false, message: "Too many attempts, wait a minute." })
  })

  test("a response with no usable secret fails closed instead of showing nothing", async () => {
    const r = await startEnrolment({ enable: async () => ({ totpURI: "otpauth://totp/x", backupCodes: [] }), verify: vi.fn() }, "pw")
    expect(r).toMatchObject({ ok: false })
  })

  test("an empty password never calls the API", async () => {
    const enable = vi.fn()
    expect(await startEnrolment({ enable, verify: vi.fn() }, "")).toMatchObject({ ok: false })
    expect(enable).not.toHaveBeenCalled()
  })

  test("confirmEnrolment accepts 6 digits (spaces allowed) and maps a wrong code to one message", async () => {
    const verify = vi.fn(async () => {})
    expect(await confirmEnrolment({ enable: vi.fn(), verify }, "123 456")).toEqual({ ok: true })
    expect(verify).toHaveBeenCalledWith("123456")
    expect(await confirmEnrolment({ enable: vi.fn(), verify }, "12345")).toMatchObject({ ok: false, message: "Enter the 6-digit code" })
    const wrong = await confirmEnrolment({ enable: vi.fn(), verify: async () => { throw problem(401, "invalid_code") } }, "000000")
    expect(wrong).toEqual({ ok: false, message: "That code is not right. Check your authenticator app and try again." })
  })

  test("disableTotpFlow maps a wrong password to one message and passes the password only to the API", async () => {
    const disable = vi.fn(async () => {})
    expect(await disableTotpFlow(disable, "pw")).toEqual({ ok: true })
    expect(disable).toHaveBeenCalledWith("pw")
    expect(await disableTotpFlow(async () => { throw problem(400, "invalid_password") }, "x")).toEqual({ ok: false, message: "That password is not right." })
    expect(await disableTotpFlow(disable, "")).toMatchObject({ ok: false })
  })
})
