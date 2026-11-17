import { describe, expect, test } from "vitest"
import { currencyAndLocale, onboardingInput, slugCandidates } from "@/lib/onboarding"

const countries = [
  { code: "IE", name: "Ireland", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE" },
  { code: "GB", name: "United Kingdom", timezone: "Europe/London", currency: "GBP", locale: "en-GB" },
]

describe("T6.3 onboarding input (POST /v1/tenants, teams, invites)", () => {
  const ok = { company: "Northgate Facility Services", timezone: "Europe/Dublin", deadline: "17:30", departments: ["Security", "Cleaning"], invites: [{ email: "Ana@Example.ie", roleKey: "manager" }] }

  test("a valid input parses; emails are lower-cased and trimmed; blank invite rows are dropped", () => {
    const r = onboardingInput.parse({ ...ok, invites: [{ email: "  Ana@Example.ie ", roleKey: "manager" }, { email: "", roleKey: "manager" }] })
    expect(r.invites).toEqual([{ email: "ana@example.ie", roleKey: "manager" }])
    expect(r.company).toBe("Northgate Facility Services")
  })

  test("what the browser sends is checked: company, timezone, deadline, departments and invites are bounded and typed", () => {
    for (const bad of [
      { ...ok, company: "" }, { ...ok, company: "x".repeat(121) }, { ...ok, company: "A\nB" }, { ...ok, timezone: "Not/AZone" }, { ...ok, deadline: "25:99" }, { ...ok, deadline: "5pm" },
      { ...ok, departments: Array.from({ length: 21 }, (_, i) => `D${i}`) }, { ...ok, departments: ["ok", ""] }, { ...ok, departments: ["a".repeat(81)] },
      { ...ok, invites: Array.from({ length: 21 }, () => ({ email: "a@x.ie", roleKey: "manager" })) }, { ...ok, invites: [{ email: "not-an-email", roleKey: "manager" }] },
      { ...ok, invites: [{ email: "a@x.ie", roleKey: "" }] }, { ...ok, invites: [{ email: "a@x.ie", roleKey: "../owner" }] }, "x", null, { ...ok, company: 5 },
    ]) expect(onboardingInput.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false)
  })

  test("duplicate department names (case-insensitive) are refused, like the form does", () => {
    expect(onboardingInput.safeParse({ ...ok, departments: ["Security", "security"] }).success).toBe(false)
  })

  test("slug candidates: lowercase, hyphenated, 3-40 chars, valid against the API's rule, with random-suffix fallbacks", () => {
    const c = slugCandidates("Northgate Facility Services", () => "ab12")
    expect(c[0]).toBe("northgate-facility-services")
    expect(c.length).toBeGreaterThan(1)
    for (const s of c) expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
    expect(c[1]).toBe("northgate-facility-services-ab12")
    expect(slugCandidates("É", () => "ab12")[0]).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/) // too short or empty: a safe default
    expect(slugCandidates("a".repeat(80), () => "ab12").every((s) => s.length <= 40)).toBe(true)
    expect(slugCandidates("--Hello  World!!", () => "zz99")[0]).toBe("hello-world")
  })

  test("currency and locale come from the country that matches the chosen timezone (data, not code); an unknown zone uses the first country", () => {
    expect(currencyAndLocale(countries, "Europe/London")).toEqual({ currency: "GBP", locale: "en-GB" })
    expect(currencyAndLocale(countries, "Europe/Dublin")).toEqual({ currency: "EUR", locale: "en-IE" })
    expect(currencyAndLocale(countries, "Asia/Tokyo")).toEqual({ currency: "EUR", locale: "en-IE" })
    expect(currencyAndLocale([{ code: "X", name: "X", timezone: "UTC" }], "UTC")).toEqual({})
  })
})
