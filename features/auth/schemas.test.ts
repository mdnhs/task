import { describe, expect, it } from "vitest"
import { mfaSchema, ownerSchema, passwordScore, signInSchema, slugify } from "./schemas"

describe("auth schemas", () => {
  it("rejects a malformed email with a fix-it message", () => {
    const r = signInSchema.safeParse({ email: "nope", password: "abcdefgh" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toMatch(/valid email/)
  })
  it("accepts any 6 digits and nothing else for MFA", () => {
    expect(mfaSchema.safeParse("123456").success).toBe(true)
    expect(mfaSchema.safeParse("12345").success).toBe(false)
    expect(mfaSchema.safeParse("12345a").success).toBe(false)
  })
  it("scores passwords by rule", () => {
    expect(passwordScore("")).toBe(0)
    expect(passwordScore("Abcdefghi1!")).toBe(4)
    expect(ownerSchema.safeParse({ name: "Ada Test", email: "a@b.co", password: "weak" }).success).toBe(false)
  })
  it("slugifies company names", () => {
    expect(slugify("Northgate  Facility Services!")).toBe("northgate-facility-services")
    expect(slugify("Café Ünïon")).toBe("cafe-union")
  })
})
