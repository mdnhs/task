import { describe, expect, test } from "vitest"
import { ApiError, classifyApiError, userMessage, type ErrorKind } from "@/lib/api/problem"

const err = (status: number, code: string, requestId = "req-1", extra: Record<string, unknown> = {}) => new ApiError(status, code, requestId, extra)

/** One row per line of the error table in the plan (constraints.md "Error code → UI"). */
const ROWS: [number, string, ErrorKind][] = [
  [401, "unauthenticated", "session_expired"],
  [401, "session_expired", "session_expired"],
  [401, "mfa_challenge", "mfa_challenge"],
  [403, "mfa_required", "mfa_challenge"],
  [401, "mfa_enrolment_required", "mfa_enrolment"],
  [403, "email_not_verified", "email_not_verified"],
  [402, "billing_required", "billing_required"],
  [403, "module_not_entitled", "module_not_entitled"],
  [403, "device_policy", "forbidden"],
  [403, "forbidden", "forbidden"],
  [403, "self_verification", "forbidden"],
  [404, "not_found", "not_found"],
  [409, "version_conflict", "version_conflict"],
  [409, "retry", "retry"],
  [409, "tenant_changed", "tenant_changed"],
  [400, "validation_failed", "validation"],
  [422, "invalid_name", "unprocessable"],
  [429, "too_many_requests", "rate_limited"],
  [502, "upstream_unavailable", "upstream"],
  [500, "internal", "upstream"],
  [503, "http_error", "upstream"],
]

describe("classifyApiError: one assertion per row of the error table", () => {
  test.each(ROWS)("%i %s -> %s", (status, code, kind) => {
    expect(classifyApiError(err(status, code))).toEqual({ kind, code })
  })

  test("a network failure (fetch rejects with a TypeError) and an abort are `network`", () => {
    expect(classifyApiError(new TypeError("fetch failed")).kind).toBe("network")
    expect(classifyApiError(new DOMException("timed out", "AbortError")).kind).toBe("network")
  })

  test("a wrong password (Better Auth 401 with its own code) is `unauthenticated`, not an expired session", () => {
    expect(classifyApiError(err(401, "invalid_email_or_password")).kind).toBe("unauthenticated")
  })

  test("another 409 (evidence_not_ready, slug_taken) is `unprocessable`: the code says which", () => {
    expect(classifyApiError(err(409, "evidence_not_ready"))).toEqual({ kind: "unprocessable", code: "evidence_not_ready" })
  })

  test("anything that is not an ApiError is `upstream` (never crashes, never leaks)", () => {
    expect(classifyApiError("boom")).toEqual({ kind: "upstream", code: "unknown" })
    expect(classifyApiError(null).kind).toBe("upstream")
  })
})

describe("ApiError.fromResponse", () => {
  test("reads a problem+json body: code, requestId and the extra members, but not title or message", async () => {
    const res = new Response(JSON.stringify({ type: "about:blank", title: "Unprocessable", status: 422, code: "report_invalid", requestId: "r-9", errors: [{ path: "items.0" }] }), {
      status: 422,
      headers: { "content-type": "application/problem+json" },
    })
    const e = await ApiError.fromResponse(res)
    expect(e).toMatchObject({ status: 422, code: "report_invalid", requestId: "r-9", extra: { errors: [{ path: "items.0" }] } })
    expect(e.extra).not.toHaveProperty("title")
    expect(e.message).not.toContain("Unprocessable")
  })

  test("a Better Auth style body ({ code: 'INVALID_EMAIL_OR_PASSWORD', message }) is lower-cased and its message dropped", async () => {
    const res = new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }), { status: 401, headers: { "content-type": "application/json", "x-request-id": "hdr-1" } })
    const e = await ApiError.fromResponse(res)
    expect(e).toMatchObject({ status: 401, code: "invalid_email_or_password", requestId: "hdr-1" })
    expect(JSON.stringify(e.extra)).not.toContain("Invalid email")
  })

  test("a body that is not JSON (an HTML error page) becomes `http_error` with the status; its text is never kept", async () => {
    const e = await ApiError.fromResponse(new Response("<html>nginx 502 at 10.0.0.5</html>", { status: 502, headers: { "x-request-id": "r-2" } }))
    expect(e).toMatchObject({ status: 502, code: "http_error", requestId: "r-2", extra: {} })
    expect(JSON.stringify(e)).not.toContain("nginx")
  })
})

describe("userMessage", () => {
  const KINDS: ErrorKind[] = ["unauthenticated", "session_expired", "mfa_challenge", "mfa_enrolment", "email_not_verified", "billing_required", "module_not_entitled", "forbidden", "not_found", "version_conflict", "retry", "tenant_changed", "validation", "unprocessable", "rate_limited", "upstream", "network"]

  test("every row of the table has short copy, and the ref is the requestId", () => {
    for (const [status, code] of ROWS) {
      const m = userMessage(err(status, code, "rid-7"))
      expect(m.text.length, code).toBeGreaterThan(3)
      expect(m.text.length, code).toBeLessThan(80)
      expect(m.ref).toBe("rid-7")
    }
    expect(KINDS.length).toBe(17)
  })

  test("it never returns the raw title, the server text or the code itself", () => {
    const e = err(422, "some_secret_code", "r-1", { title: "Internal detail: pg_hba.conf", message: "stack at /srv/api/x.ts", detail: "SELECT *" })
    const m = userMessage(e)
    expect(m.text).not.toMatch(/pg_hba|stack|SELECT|some_secret_code|Internal detail/)
  })

  test("known codes get their own copy (self_verification, evidence_not_ready, device_policy)", () => {
    expect(userMessage(err(403, "self_verification")).text).toMatch(/own/i)
    expect(userMessage(err(409, "evidence_not_ready")).text).toMatch(/evidence/i)
    expect(userMessage(err(403, "device_policy")).text).toMatch(/work pc/i)
  })

  test("ref is null when there is no request id (a network failure), and never the empty string", () => {
    expect(userMessage(new TypeError("fetch failed")).ref).toBeNull()
    expect(userMessage(err(500, "internal", "")).ref).toBeNull()
  })
})
