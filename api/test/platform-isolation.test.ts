import { beforeAll, describe, expect, test } from "vitest"
import { call, resetDb, testApp } from "./harness"
import { makeStaff, makeTenant } from "./factories"
import { actorIn, routeInventory, type Actor } from "./route-fixtures"

/**
 * B7 Task 14 / ruling C4: the platform half of the isolation gate (blocking in CI, like isolation.test.ts).
 * /v1/platform/* is staff-by-design, so the A-owner walk of AC-M0-01 cannot apply. The replacement is:
 *  1. every platform operation (taken from the OpenAPI document, never hand-listed) answers a tenant OWNER, who is not staff,
 *     with the 404 of a route that does not exist: same status, same body (the request id aside), same content type;
 *  2. as staff, every `{tenantId}` / `{id}` route answers 404 for a nil uuid (no write, no oracle);
 *  3. no platform response carries another tenant's secrets or members, and the platform's own secrets are masked.
 */
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const NIL = "00000000-0000-4000-8000-000000000000"

let t: ReturnType<typeof testApp>
let ownerA: Actor & { email: string }
let tenantA: { id: string; slug: string }
let staffCookie: string
let doc: { paths: Record<string, Record<string, Json>> }

const example = (op: Json): unknown => {
  const schema = op.requestBody?.content?.["application/json"]?.schema as Json | undefined
  return op.requestBody ? (schema?.example ?? schema?.examples?.[0]) : undefined
}
const ops = () =>
  Object.entries(doc.paths)
    .filter(([p]) => p.startsWith("/v1/platform/"))
    .flatMap(([path, item]) => ["get", "put", "post", "delete", "patch"].filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path, op: item[m], key: `${m.toUpperCase()} ${path}` })))
const fill = (path: string) => path.replace(/\{(\w+)\}/g, (_, p) => (p === "userId" ? "usr_ghost" : NIL))
const norm = (text: string) => text.replace(/"requestId":"[^"]+"/, '"requestId":"-"')

beforeAll(async () => {
  await resetDb()
  t = testApp()
  tenantA = await makeTenant(t.deps, { slug: "plat-alpha", name: "Platform Alpha Ltd" })
  ownerA = await actorIn(t, tenantA, "owner")
  staffCookie = (await makeStaff(t.deps, "owner")).cookie!
  doc = (await (await call(t.app, "GET", "/v1/openapi.json")).json()) as typeof doc
}, 120_000)

describe("platform routes are invisible to a tenant owner", () => {
  test("the platform operation list is real and includes the B7 routes", () => {
    const keys = ops().map((o) => o.key)
    expect(keys.length).toBeGreaterThanOrEqual(25)
    for (const k of ["GET /v1/platform/session", "GET /v1/platform/support-grants", "GET /v1/platform/tenants/{tenantId}", "PUT /v1/platform/settings/billing"]) expect(keys).toContain(k)
    const inv = routeInventory(t.app).filter((e) => e.path.startsWith("/v1/platform/")).map((e) => e.key)
    expect(inv.sort()).toEqual(keys.sort()) // the inventory and this walk see the same routes
  })

  test("as tenant A's owner (non-staff) every /v1/platform route is 404 not_found with a body identical to a never-existing route", async () => {
    const never = await call(t.app, "GET", "/v1/platform/never-existing-route", { cookie: ownerA.cookie, tenant: tenantA.slug })
    expect(never.status).toBe(404)
    const wantBody = norm(await never.text())
    expect(JSON.parse(wantBody).code).toBe("not_found")
    const failures: string[] = []
    for (const o of ops()) {
      for (const tenant of [undefined, tenantA.slug]) {
        const r = await call(t.app, o.method, fill(o.path), { cookie: ownerA.cookie, tenant, body: example(o.op) })
        const text = norm(await r.text())
        if (r.status !== 404) failures.push(`${o.key} (x-tenant=${tenant}) -> ${r.status}`)
        else if (text !== wantBody) failures.push(`${o.key} (x-tenant=${tenant}): body differs from a never-existing route: ${text.slice(0, 100)}`)
        if (r.headers.get("content-type") !== never.headers.get("content-type")) failures.push(`${o.key}: content-type ${r.headers.get("content-type")}`)
      }
    }
    expect(failures).toEqual([])
  })

  test("with no session at all every platform route is 401, never a 404 that would tell a stranger where staff routes are", async () => {
    const failures: string[] = []
    for (const o of ops()) {
      const r = await call(t.app, o.method, fill(o.path), { body: example(o.op) })
      if (r.status !== 401) failures.push(`${o.key} -> ${r.status}`)
    }
    expect(failures).toEqual([])
  })
})

describe("platform routes as staff", () => {
  test("every {tenantId} / {id} route answers 404 for a nil uuid, and the staff user path for an unknown user", async () => {
    const failures: string[] = []
    let walked = 0
    for (const o of ops().filter((x) => x.path.includes("{"))) {
      if (o.path.includes("{userId}")) continue // staff users, not tenant data: covered by platform.test.ts
      const r = await call(t.app, o.method, fill(o.path), { cookie: staffCookie, body: example(o.op) })
      walked++
      const code = ((await r.json()) as Json).code
      if (r.status !== 404) failures.push(`${o.key} -> ${r.status} ${code} (want 404 for a nil uuid)`)
    }
    expect(walked).toBeGreaterThanOrEqual(6)
    expect(failures).toEqual([])
  })

  test("staff never see another route's tenant secrets, member emails or the platform's own secrets in any GET body", async () => {
    // tenant A holds an API key, a webhook secret and members
    const key = await call(t.app, "POST", "/v1/api-keys", { cookie: ownerA.cookie, tenant: tenantA.slug, body: { name: "iso", scopes: ["settings:write"] } })
    expect(key.status).toBe(201)
    const apiKey = ((await key.json()) as Json).key as string
    const hook = await call(t.app, "POST", "/v1/webhooks", { cookie: ownerA.cookie, tenant: tenantA.slug, body: example(doc.paths["/v1/webhooks"].post) })
    expect(hook.status, await hook.clone().text()).toBe(201)
    const hookSecret = ((await hook.json()) as Json).secret as string
    // the platform's own secrets, set through the real routes with the OpenAPI example values
    const secrets: string[] = []
    for (const [path, fieldNames] of [["/v1/platform/settings/email", ["apiKey"]], ["/v1/platform/settings/storage", ["secretAccessKey"]], ["/v1/platform/settings/billing", ["secretKey", "webhookSecret"]]] as const) {
      const body = example(doc.paths[path].put) as Json
      const put = await call(t.app, "PUT", path, { cookie: staffCookie, body })
      expect(put.status, `PUT ${path}: ${await put.clone().text()}`).toBe(200)
      for (const f of fieldNames) secrets.push(String(body[f]))
    }
    expect(secrets.length).toBe(4)
    const marks = [apiKey, hookSecret, ownerA.email, ...secrets].filter(Boolean)
    expect(marks.length).toBeGreaterThanOrEqual(5)
    const gets = ops().filter((o) => o.method === "GET")
    const failures: string[] = []
    for (const o of gets) {
      const path = o.path.replace(/\{tenantId\}/g, tenantA.id)
      const r = await call(t.app, "GET", path, { cookie: staffCookie })
      const text = await r.text()
      if (r.status >= 500) failures.push(`${o.key} -> ${r.status}`)
      for (const m of marks) if (text.includes(m)) failures.push(`${o.key} leaks ${m.slice(0, 8)}...`)
      if (/"(secret|secretKey|apiKey|secretAccessKey|webhookSecret|keyHash|secretHash|tokenHash|token)"\s*:/.test(text)) failures.push(`${o.key}: carries a secret-named field (the audit chain hash is not a secret)`)
    }
    expect(gets.length).toBeGreaterThanOrEqual(9)
    expect(failures).toEqual([])
    // the masked views really show only the last 4
    const storage = (await (await call(t.app, "GET", "/v1/platform/settings/storage", { cookie: staffCookie })).json()) as Json
    expect(storage.secretLast4).toBe(secrets[1].slice(-4))
  })
})
