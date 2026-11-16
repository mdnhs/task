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
