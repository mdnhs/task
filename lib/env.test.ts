import { afterEach, describe, expect, test, vi } from "vitest"
import { assertServerEnv, serverEnvProblems } from "@/lib/env"

afterEach(() => vi.unstubAllEnvs())

const good = { NODE_ENV: "production", APP_ORIGIN: "https://app.example.com", API_URL: "http://api.internal:3001" }

describe("M6: the web server refuses to boot in production without APP_ORIGIN (and API_URL)", () => {
  test("a complete production env has no problems", () => {
    expect(serverEnvProblems(good)).toEqual([])
    expect(() => assertServerEnv(good)).not.toThrow()
  })

  test("APP_ORIGIN unset, blank, a path, a non-http scheme or garbage is a boot error naming the variable", () => {
    for (const v of [undefined, "", "   ", "app.example.com", "ftp://app.example.com", "https://app.example.com/path", "https://app.example.com/", "https://u:p@app.example.com", "javascript:alert(1)"]) {
      const env = { ...good, APP_ORIGIN: v } as Record<string, string | undefined>
      expect(serverEnvProblems(env).join(" "), String(v)).toMatch(/APP_ORIGIN/)
      expect(() => assertServerEnv(env), String(v)).toThrow(/APP_ORIGIN/)
    }
  })

  test("API_URL unset or not http(s) is a boot error in production", () => {
    for (const v of [undefined, "", "api.internal", "ftp://x"]) expect(() => assertServerEnv({ ...good, API_URL: v } as Record<string, string | undefined>), String(v)).toThrow(/API_URL/)
  })

  test("the message says how to fix it and never prints a value", () => {
    try {
      assertServerEnv({ NODE_ENV: "production", APP_ORIGIN: "https://secret-host.example.com/x", API_URL: "" })
      expect.unreachable()
    } catch (e) {
      const m = (e as Error).message
      expect(m).toMatch(/scheme:\/\/host/)
      expect(m).not.toContain("secret-host")
    }
  })

  test("development, test and the build never fail on a missing value", () => {
    for (const NODE_ENV of ["development", "test", undefined]) expect(() => assertServerEnv({ NODE_ENV } as Record<string, string | undefined>)).not.toThrow()
    expect(() => assertServerEnv({ ...good, APP_ORIGIN: "", NEXT_PHASE: "phase-production-build" })).not.toThrow()
  })

  test("it reads process.env by default", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_ORIGIN", "")
    expect(() => assertServerEnv()).toThrow(/APP_ORIGIN/)
  })

  test("instrumentation.ts runs it once at server start (nodejs runtime only) and exits the process on an invalid production env", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("APP_ORIGIN", "")
    const { register } = await import("@/instrumentation")
    await register()
    expect(exit).toHaveBeenCalledWith(1)
    expect(String(err.mock.calls[0]?.[0])).toMatch(/APP_ORIGIN/)
    exit.mockClear()
    vi.stubEnv("NEXT_RUNTIME", "edge")
    await register()
    expect(exit).not.toHaveBeenCalled()
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("APP_ORIGIN", "https://app.example.com")
    vi.stubEnv("API_URL", "http://api:3001")
    await register()
    expect(exit).not.toHaveBeenCalled()
    exit.mockRestore()
    err.mockRestore()
  })
})
