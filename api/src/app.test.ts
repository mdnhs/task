import { validator } from "hono/validator"
import { expect, test } from "vitest"
import { call, testApp } from "../test/harness"
import { Conflict } from "./core/errors"

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
test("incoming x-request-id is echoed, missing one is generated", async () => {
  const { app } = testApp()
  expect((await call(app, "GET", "/healthz", { headers: { "x-request-id": "abc" } })).headers.get("x-request-id")).toBe("abc")
  expect((await call(app, "GET", "/healthz")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
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
