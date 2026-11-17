import { describe, expect, test } from "vitest"
import { call, testApp, testEnv } from "../../../test/harness"

const withEnv = (over: Record<string, string | undefined>) => testApp({ env: { ...testEnv, ...over } })

describe("T6.3 GET /v1/auth/providers (I23 c)", () => {
  test("lists only providers with BOTH an id and a secret, needs no session, and carries no secret", async () => {
    const { app } = withEnv({ GOOGLE_CLIENT_ID: "gid-123", GOOGLE_CLIENT_SECRET: "gsecret-456", MICROSOFT_CLIENT_ID: "mid-789", MICROSOFT_CLIENT_SECRET: "" })
    const r = await call(app, "GET", "/v1/auth/providers")
    expect(r.status).toBe(200)
    const text = await r.text()
    expect(JSON.parse(text)).toEqual({ google: true, microsoft: false })
    for (const s of ["gid-123", "gsecret-456", "mid-789"]) expect(text).not.toContain(s)
  })

  test("nothing configured: both false; secret without id: false", async () => {
    expect(await (await call(withEnv({}).app, "GET", "/v1/auth/providers")).json()).toEqual({ google: false, microsoft: false })
    const { app } = withEnv({ GOOGLE_CLIENT_SECRET: "only-secret", MICROSOFT_CLIENT_ID: "only-id" })
    expect(await (await call(app, "GET", "/v1/auth/providers")).json()).toEqual({ google: false, microsoft: false })
  })

  test("it is in the OpenAPI document with a typed response", async () => {
    const { app } = withEnv({})
    const doc = (await (await call(app, "GET", "/v1/openapi.json")).json()) as { paths: Record<string, { get?: { responses: Record<string, unknown> } }> }
    expect(doc.paths["/v1/auth/providers"]?.get?.responses["200"]).toBeTruthy()
  })
})
