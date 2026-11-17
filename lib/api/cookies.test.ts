import { describe, expect, test } from "vitest"
import { allowedCookieHeader, cookieValue, isForwardedCookie } from "@/lib/api/cookies"

describe("cookie allow-list (I6)", () => {
  test("forwards only better-auth, __Secure-better-auth and __Host-od-device cookies; od-tenant and anything else stay home", () => {
    const header = [
      "better-auth.session_token=abc.def",
      "__Secure-better-auth.session_token=s3",
      "__Host-od-device-1a2b3c4d=sig.val",
      "od-tenant=acme",
      "od-role=owner",
      "_ga=GA1.2.3",
      "session=evil",
      "better-authx=1",
      "x-better-auth.session_token=1",
    ].join("; ")
    expect(allowedCookieHeader(header)).toBe("better-auth.session_token=abc.def; __Secure-better-auth.session_token=s3; __Host-od-device-1a2b3c4d=sig.val")
  })

  test("values keep their = signs and are passed through unchanged", () => {
    expect(allowedCookieHeader("better-auth.session_data=eyJh==.sig%3D; od-tenant=x")).toBe("better-auth.session_data=eyJh==.sig%3D")
  })

  test("null, empty and malformed headers give an empty string", () => {
    expect(allowedCookieHeader(null)).toBe("")
    expect(allowedCookieHeader("")).toBe("")
    expect(allowedCookieHeader("; ;novalue; =x")).toBe("")
  })

  test("the un-prefixed device cookie (plain-http dev and e2e) is forwarded outside production only", () => {
    expect(isForwardedCookie("od-device-1a2b3c4d", { production: false })).toBe(true)
    expect(isForwardedCookie("od-device-1a2b3c4d", { production: true })).toBe(false)
    expect(isForwardedCookie("__Host-od-device-1a2b3c4d", { production: true })).toBe(true)
    expect(isForwardedCookie("__Host-od-device-evil", { production: true })).toBe(false)
  })

  test("cookieValue reads one cookie, first occurrence wins, and decodes nothing", () => {
    expect(cookieValue("a=1; od-tenant=acme; od-tenant=other", "od-tenant")).toBe("acme")
    expect(cookieValue("a=1", "od-tenant")).toBeNull()
    expect(cookieValue(null, "od-tenant")).toBeNull()
  })
})
