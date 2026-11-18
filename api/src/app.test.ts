import { validator } from "hono/validator"
import { expect, test } from "vitest"
import { call, testApp } from "../test/harness"
import { Conflict } from "./core/errors"
import { makeLogger } from "./core/observability/logger"
import { fakeErrorReporter } from "./core/observability/error-reporter"
import { makeMember, makeTenant, signIn } from "../test/factories"
import { resetDb, testDb } from "../test/db"
import { requireTenant } from "./core/middleware/tenant"
import { rateLimit } from "./core/middleware/rate-limit"
import { readiness } from "./core/observability/readiness"

test("GET /healthz returns 200 ok", async () => {
  const r = await call(testApp().app, "GET", "/healthz")
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ status: "ok" })
})
test("unknown route returns problem+json 404", async () => {
  const r = await call(testApp().app, "GET", "/v1/nope")
  expect(r.status).toBe(404)
  expect(r.headers.get("content-type")).toMatch(/application\/problem\+json/)
  expect(await r.json()).toMatchObject({ status: 404, title: "Not Found", code: "not_found", requestId: expect.any(String) })
})
test("every response carries x-request-id and an incoming valid one is reused, an over-long or non-uuid-ish one is replaced", async () => {
  const { app } = testApp()
  const id = "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10"
  expect((await call(app, "GET", "/healthz", { headers: { "x-request-id": id } })).headers.get("x-request-id")).toBe(id)
  expect((await call(app, "GET", "/healthz")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  for (const bad of ["abc", "x".repeat(65), "has space in it", "<script>alert(1)</script>", "id;rm -rf /", "\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9\u00e9"]) {
    const r = await call(app, "GET", "/v1/nope", { headers: { "x-request-id": bad } })
    expect(r.headers.get("x-request-id"), bad).toMatch(/^[0-9a-f-]{36}$/)
    expect(((await r.json()) as { requestId: string }).requestId, bad).toBe(r.headers.get("x-request-id"))
  }
})
test("AppError maps to its status; unknown errors become 500 without stack", async () => {
  const { app } = testApp()
  app.get("/v1/_conflict", () => { throw Conflict("dup") })
  app.get("/v1/_boom", () => { throw new Error("secret detail") })
  expect((await call(app, "GET", "/v1/_conflict")).status).toBe(409)
  const r = await call(app, "GET", "/v1/_boom")
  expect(r.status).toBe(500)
  expect(await r.text()).not.toContain("secret detail")
})
test("GET /readyz returns 503 when the db ping fails", async () => {
  const { app } = testApp({ db: { execute: async () => { throw new Error("down") } } as never })
  expect((await call(app, "GET", "/readyz")).status).toBe(503)
})
test("GET /v1/openapi.json serves OpenAPI 3.1 with version 1", async () => {
  const j = (await (await call(testApp().app, "GET", "/v1/openapi.json")).json()) as { openapi: string; info: { version: string } }
  expect(j.openapi).toMatch(/^3\.1/)
  expect(j.info.version).toBe("1")
})
test("malformed JSON body is 400 problem+json, not 500", async () => {
  const { app } = testApp()
  app.post("/v1/_json", validator("json", (v) => v), (c) => c.json({ ok: true }))
  const r = await call(app, "POST", "/v1/_json", { headers: { "content-type": "application/json" } })
  const bad = await app.request("/v1/_json", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" })
  expect(r.status).toBe(400)
  expect(bad.status).toBe(400)
  expect(bad.headers.get("content-type")).toMatch(/application\/problem\+json/)
  expect(await bad.json()).toMatchObject({ status: 400, code: "bad_request", requestId: expect.any(String) })
})

test("M6c: Postgres 40P01 (deadlock) and 40001 (serialisation failure), read from .cause.code, are a retryable 409 `retry`; other SQLSTATEs stay 500", async () => {
  const { app } = testApp()
  const pgErr = (code: string) => Object.assign(new Error("query failed secret detail"), { cause: Object.assign(new Error("pg"), { code }) })
  app.get("/v1/_deadlock", () => { throw pgErr("40P01") })
  app.get("/v1/_serial", () => { throw pgErr("40001") })
  app.get("/v1/_unique", () => { throw pgErr("23505") })
  for (const path of ["/v1/_deadlock", "/v1/_serial"]) {
    const r = await call(app, "GET", path)
    expect(r.status).toBe(409)
    expect(r.headers.get("content-type")).toMatch(/application\/problem\+json/)
    expect(await r.json()).toMatchObject({ status: 409, code: "retry", requestId: expect.any(String) })
  }
  const other = await call(app, "GET", "/v1/_unique")
  expect(other.status).toBe(500)
  expect(await other.text()).not.toContain("secret detail")
})

test("every API response carries x-content-type-options nosniff, the security headers and a request id", async () => {
  const { app } = testApp()
  app.get("/v1/_boom2", () => { throw new Error("x") })
  app.get("/v1/_json", (c) => c.json({ a: 1 }))
  app.get("/v1/_dl", (c) => c.body("a,b", 200, { "content-type": "text/csv", "content-disposition": 'attachment; filename="x.csv"', "cache-control": "no-store" }))
  app.get("/v1/_redir", (c) => c.redirect("https://files.example/x", 302))
  for (const path of ["/healthz", "/v1/nope", "/v1/_boom2", "/v1/_json", "/v1/_dl", "/v1/_redir", "/v1/openapi.json"]) {
    const r = await call(app, "GET", path)
    expect(r.headers.get("x-content-type-options"), path).toBe("nosniff")
    expect(r.headers.get("x-request-id"), path).toBeTruthy()
    expect(r.headers.get("referrer-policy"), path).toBe("no-referrer")
    expect(r.headers.get("cross-origin-resource-policy"), path).toBe("same-site")
    expect(r.headers.get("content-security-policy"), path).toBe("default-src 'none'; frame-ancestors 'none'")
  }
  expect((await call(app, "GET", "/v1/_json")).headers.get("cache-control")).toBe("no-store")
  expect((await call(app, "GET", "/v1/_boom2")).headers.get("cache-control")).toBe("no-store")
  expect((await call(app, "GET", "/v1/_dl")).headers.get("content-disposition")).toContain("attachment")
})

// ---- B7 Task 15: request context, access log, error reports, readiness, metrics ----
const logCapture = () => {
  const lines: string[] = []
  const logger = makeLogger({ level: "debug", destination: { write: (x: string) => void lines.push(x) } })
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, any>) } // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("the access log has the route template, not the concrete path, and no query string, cookie, authorization header or body", async () => {
  const { logger, lines, parsed } = logCapture()
  const t = testApp({ logger })
  t.app.post("/v1/_things/:id", async (c) => {
    t.clock.advance({ minutes: 1 })
    return c.json({ ok: true, big: "x".repeat(100) })
  })
  const r = await call(t.app, "POST", "/v1/_things/7f3c2d1e-aaaa-bbbb-cccc-123456789012?token=QUERYSECRET&email=a@b.ie", {
    headers: { cookie: "sid=COOKIESECRET", authorization: "Bearer HEADERSECRET", "x-request-id": "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10" },
    body: { password: "BODYSECRET" },
  })
  expect(r.status).toBe(200)
  const out = lines.join("")
  for (const s of ["QUERYSECRET", "COOKIESECRET", "HEADERSECRET", "BODYSECRET", "7f3c2d1e", "a@b.ie"]) expect(out, s).not.toContain(s)
  const access = parsed().filter((l) => l.msg === "request")
  expect(access).toHaveLength(1) // exactly one line per request
  expect(access[0]).toMatchObject({ method: "POST", route: "/v1/_things/{id}", status: 200, durationMs: 60000, requestId: "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10" })
  expect(access[0].bytes).toBeNull() // no content-length on the response: never buffered to count it
  expect(Object.keys(access[0]).sort()).toEqual(["bytes", "durationMs", "level", "method", "msg", "requestId", "route", "service", "status", "time"].sort())
})

test("an unmatched path is logged under a fixed label, so scanners cannot create log or metric series", async () => {
  const { logger, parsed } = logCapture()
  const t = testApp({ logger })
  await call(t.app, "GET", "/v1/nope-1")
  await call(t.app, "GET", "/v1/nope-2")
  expect(parsed().filter((l) => l.msg === "request").map((l) => l.route)).toEqual(["unmatched", "unmatched"])
  expect(t.metrics.render()).toContain('http_requests_total{method="GET",route="unmatched",status_class="4xx"} 2')
})

test("the access log carries tenantId and userId once the request resolved them, and c.get('log') has them too", async () => {
  await resetDb()
  const { logger, parsed } = logCapture()
  const t = testApp({ logger })
  t.app.get("/v1/_who", requireTenant, (c) => {
    c.get("log").info("inside the handler")
    return c.json({ ok: true })
  })
  const tenant = await makeTenant(t.deps)
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const cookie = (await signIn(t.app, owner.email, owner.password)).cookie
  const r = await call(t.app, "GET", "/v1/_who", { cookie, tenant: tenant.slug })
  expect(r.status).toBe(200)
  const lines = parsed().filter((l) => l.requestId === r.headers.get("x-request-id"))
  expect(lines.find((l) => l.msg === "inside the handler")).toMatchObject({ tenantId: tenant.id, userId: owner.userId })
  expect(lines.find((l) => l.msg === "request")).toMatchObject({ tenantId: tenant.id, userId: owner.userId, route: "/v1/_who" })
})

test("a 500 calls errorReporter.capture with requestId and tenantId and the response has no error text", async () => {
  await resetDb()
  const errorReporter = fakeErrorReporter()
  const t = testApp({ errorReporter })
  t.app.get("/v1/_boom3/:id", requireTenant, () => {
    throw Object.assign(new Error("Failed query: select secret@example.com"), { cause: { code: "23505" } })
  })
  t.app.get("/v1/_conflict2", () => { throw Conflict("dup") })
  const tenant = await makeTenant(t.deps)
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const cookie = (await signIn(t.app, owner.email, owner.password)).cookie
  const r = await call(t.app, "GET", "/v1/_boom3/9", { cookie, tenant: tenant.slug })
  expect(r.status).toBe(500)
  const text = await r.text()
  expect(text).not.toMatch(/Failed query|secret@example|stack|at \w+ \(/)
  expect(JSON.parse(text)).toEqual({ type: "about:blank", title: "Internal Server Error", status: 500, code: "internal", requestId: r.headers.get("x-request-id") })
  expect(errorReporter.captured).toHaveLength(1)
  expect(errorReporter.captured[0].ctx).toEqual({ requestId: r.headers.get("x-request-id"), tenantId: tenant.id, userId: owner.userId, route: "/v1/_boom3/{id}" })
  // a 4xx AppError is not an error report
  await call(t.app, "GET", "/v1/_conflict2")
  expect(errorReporter.captured).toHaveLength(1)
})

test("a reporter that throws does not turn the 500 into anything else", async () => {
  const errorReporter = { capture: () => { throw new Error("reporter down") } }
  const { app } = testApp({ errorReporter })
  app.get("/v1/_boom4", () => { throw new Error("x") })
  const r = await call(app, "GET", "/v1/_boom4")
  expect(r.status).toBe(500)
  expect(((await r.json()) as { code: string }).code).toBe("internal")
})

test("public /readyz is ok or not ok only: no check names, counts, flags or error text", async () => {
  await resetDb()
  const t = testApp()
  const ok = await call(t.app, "GET", "/readyz")
  expect(ok.status).toBe(200)
  expect(await ok.json()).toEqual({ status: "ready" })
  t.rateLimiter.down = true
  t.clock.advance({ minutes: 1 }) // past the 2 s cache
  const down = await call(t.app, "GET", "/readyz")
  expect(down.status).toBe(503)
  const text = await down.text()
  expect(JSON.parse(text)).toEqual({ status: "unavailable" })
  expect(text).not.toMatch(/redis|postgres|migrations|expected|applied|storage|configured|localhost|password|down/i)
})

test("readiness details name each dependency and 503 when redis is down, with no connection string (internal use only)", async () => {
  await resetDb()
  const t = testApp()
  const ok = await readiness(t.deps)
  expect(ok.status).toBe("ready")
  expect(ok.body).toMatchObject({ status: "ready", checks: { db: { ok: true }, redis: { ok: true }, queue: { ok: true }, migrations: { ok: true } }, storage: { configured: expect.any(Boolean) } })
  const m = (ok.body as any).checks.migrations // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(m.expected).toBeGreaterThan(40)
  expect(m.applied).toBe(m.expected)
  t.rateLimiter.down = true
  t.clock.advance({ minutes: 1 })
  const down = await readiness(t.deps)
  expect(down.status).toBe("unavailable")
  expect(down.body).toMatchObject({ checks: { db: { ok: true }, redis: { ok: false }, queue: { ok: true } } })
  expect(JSON.stringify(down.body)).not.toMatch(/redis:\/\/|postgres:\/\/|localhost|password/i)
  t.rateLimiter.down = false
  t.queue.down = true
  t.clock.advance({ minutes: 1 })
  expect((await readiness(t.deps)).body).toMatchObject({ checks: { redis: { ok: true }, queue: { ok: false } } })
})

test("readiness is single-flight and cached for 2 s on deps.clock: a flood runs one check, not one per request", async () => {
  await resetDb()
  const real = testDb()
  let executes = 0
  const counting = new Proxy(real, { get: (tg, p, r) => (p === "execute" ? (q: unknown) => (executes++, real.execute(q as never)) : Reflect.get(tg, p, r)) })
  const t = testApp({ db: counting as never })
  const flood = await Promise.all(Array.from({ length: 30 }, () => call(t.app, "GET", "/readyz")))
  expect(flood.map((r) => r.status)).toEqual(Array(30).fill(200))
  const first = executes
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThanOrEqual(3) // select 1, migration count, storage settings: once
  await call(t.app, "GET", "/readyz")
  expect(executes).toBe(first) // inside the 2 s window: served from the cache
  t.clock.advance({ minutes: 1 })
  await call(t.app, "GET", "/readyz")
  expect(executes).toBe(first * 2) // the window passed: one more check
})

test("readiness never calls a live provider: storage is a config-presence flag and the mail/billing/oauth/net fakes are untouched", async () => {
  await resetDb()
  const t = testApp()
  await call(t.app, "GET", "/readyz")
  await readiness(t.deps)
  expect(t.mailer.sent).toHaveLength(0)
  expect(t.net.sent).toHaveLength(0)
  expect(t.net.resolves).toHaveLength(0)
})

test("readiness with a failing database is 503 and nothing leaks", async () => {
  const t = testApp({ db: { execute: async () => { throw new Error("connect ECONNREFUSED postgres://app_user:pw@db:5432/x") } } as never })
  const r = await call(t.app, "GET", "/readyz")
  expect(r.status).toBe(503)
  expect(await r.json()).toEqual({ status: "unavailable" })
  const d = await readiness(t.deps)
  expect((d.body as any).checks.db).toEqual({ ok: false }) // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(JSON.stringify(d.body)).not.toMatch(/ECONNREFUSED|postgres:\/\/|app_user/)
})

test("a streamed response (CSV export) is delivered incrementally and is the very response object the handler made: the access log never buffers or rebuilds it", async () => {
  const { logger, parsed } = logCapture()
  const t = testApp({ logger })
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const enc = new TextEncoder()
  const stream = new ReadableStream({ async start(ctrl) { ctrl.enqueue(enc.encode("a,b\n")); await gate; ctrl.enqueue(enc.encode("c,d\n")); ctrl.close() } })
  const made = new Response(stream, { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="x.csv"' } })
  t.app.get("/v1/_csv", () => made)
  const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error("buffered: no response before the producer finished")), ms))
  try {
    const res = await Promise.race([call(t.app, "GET", "/v1/_csv"), timeout(1500)])
    expect(res).toBe(made) // not rebuilt
    expect(res.body).toBe(stream)
    const reader = res.body!.getReader()
    const first = await Promise.race([reader.read(), timeout(1500)])
    expect(new TextDecoder().decode(first.value)).toBe("a,b\n") // first chunk before the producer finished
    release()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("c,d\n")
  } finally {
    release()
  }
  const line = parsed().find((l) => l.route === "/v1/_csv")
  expect(line).toMatchObject({ status: 200, bytes: null })
})

test("the http method metric label is an allow-list: an odd method is `other`", async () => {
  const t = testApp()
  await t.app.request("/healthz", { method: "PROPFIND" })
  await call(t.app, "GET", "/healthz")
  const out = t.metrics.render()
  expect(out).toContain('method="other"')
  expect(out).not.toContain("PROPFIND")
  expect(out).toContain('method="GET"')
})

test("rate_limited_total only ever carries a static bucket name: a odd name becomes `other`", async () => {
  const t = testApp()
  t.app.get("/v1/_limited2", rateLimit("Weird Bucket/" + "x".repeat(40), { limit: 1, windowSec: 60 }, () => "k"), (c) => c.json({ ok: true }))
  await call(t.app, "GET", "/v1/_limited2")
  await call(t.app, "GET", "/v1/_limited2")
  expect(t.metrics.render()).toContain('rate_limited_total{bucket="other"} 1')
})

test("the public app serves no /metrics (it lives on the internal metrics port only)", async () => {
  const { app } = testApp()
  for (const path of ["/metrics", "/v1/metrics"]) expect((await call(app, "GET", path)).status).toBe(404)
})

test("rate_limited_total counts a refused request by bucket", async () => {
  const t = testApp()
  t.app.get("/v1/_limited", rateLimit("probe", { limit: 1, windowSec: 60 }, () => "k"), (c) => c.json({ ok: true }))
  expect((await call(t.app, "GET", "/v1/_limited")).status).toBe(200)
  expect((await call(t.app, "GET", "/v1/_limited")).status).toBe(429)
  expect(t.metrics.render()).toContain('rate_limited_total{bucket="probe"} 1')
})
