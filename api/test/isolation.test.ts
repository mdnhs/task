import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { call, resetDb, testApp } from "./harness"
import { ownerTenantQuery } from "./db"
import { makeMember, makeTenant } from "./factories"
import { actorIn, fixtureIds, ROUTE_PARAMS, type Actor, type World } from "./route-fixtures"
import { memberships, roles } from "../src/db/schema"

/**
 * AC-M0-01: cross-tenant isolation walker. It gates every release.
 *
 * As the OWNER of tenant A (X-Tenant: A), every OpenAPI operation that has a path param is called with tenant B's
 * record ids. Each must answer 404 (never 403, never 2xx), with a problem+json body that leaks nothing of B.
 * It is built so it cannot pass vacuously:
 *  - a route with a path param but no fixture, or a JSON body without an `example` (R5), FAILS by name;
 *  - a control run calls the same operations with tenant A's OWN ids and requires "not 404" (so the route exists,
 *    the body validates and the handler really reaches the lookup);
 *  - B's 404 must carry the same error code as a never-existing id (B's data is indistinguishable from absent);
 *  - B's data (row hashes) must be identical before and after the walk (no cross-tenant write got through).
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const METHODS = ["get", "put", "post", "delete", "patch"]
const NIL_UUID = "00000000-0000-4000-8000-000000000000"

/**
 * EXPLICIT EXCLUSIONS from the "404 for tenant B's id" assertion. There is no other skip in this file.
 * A route is excluded only when NONE of its path params is a tenant record id (all are `kind: "static"`):
 * the param is a fixed vocabulary word and the row is addressed by the caller's tenant, never by the param.
 * Those are still exercised, with the stronger check in the "static-param routes" test below.
 */
const NOT_APPLICABLE: Record<string, string> = {
  "PUT /v1/device-policies/{feature}": "{feature} is a vocabulary word (drive|payroll); the policy row is keyed by the caller's tenant. Checked instead: B's policies are unchanged by A's PUT.",
}

/** The control run needs A-valid bodies where the documented example points at an id that cannot exist. */
const CONTROL_BODY = (w: World, key: string): unknown | undefined => {
  if (key === "PATCH /v1/members/{userId}") return { roleId: w.resources.role } // example roleId is the nil uuid
  if (key === "PUT /v1/members/{userId}/manager") return { managerId: null }
  if (key === "PUT /v1/teams/{id}/members") return { userIds: [w.resources.member] }
  return undefined
}

let t: ReturnType<typeof testApp>
let ownerA: Actor
let a: World
let b: World
let doc: { paths: Record<string, Record<string, Json>> }

async function buildWorld(slug: string): Promise<World> {
  const tenant = await makeTenant(t.deps, { slug })
  const owner = await actorIn(t, tenant, "owner")
  const staff = await actorIn(t, tenant, "employee")
  const f = await fixtureIds(t, tenant, owner, staff)
  return { tenant, owner, staff, ...f, marks: [...f.marks, f.resources.role, owner.email, staff.email] }
}

const bodyExample = (op: Json): { present: boolean; example?: unknown } => {
  const schema = op.requestBody?.content?.["application/json"]?.schema as Json | undefined
  if (!op.requestBody) return { present: false }
  return { present: true, example: schema?.example ?? schema?.examples?.[0] }
}

const substitute = (path: string, params: Record<string, string>) => path.replace(/\{(\w+)\}/g, (_, p) => encodeURIComponent(params[p]))

async function hashes(tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const tbl of ["roles", "memberships", "teams", "team_members", "reporting_lines", "devices", "device_policies", "invites", "audit_events", "tenant_settings"]) {
    const [r] = await ownerTenantQuery(tenantId, `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)), '') as h from ${tbl} x`)
    out[tbl] = String(r.h)
  }
  return out
}

beforeAll(async () => {
  await resetDb()
  t = testApp()
  a = await buildWorld("iso-alpha")
  b = await buildWorld("iso-bravo")
  ownerA = a.owner
  doc = (await (await call(t.app, "GET", "/v1/openapi.json")).json()) as typeof doc
}, 120_000)

type Op = { method: string; path: string; key: string; op: Json; params: string[] }
const operations = (): Op[] =>
  Object.entries(doc.paths).flatMap(([path, item]) => {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (params.length === 0) return []
    return METHODS.filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path, key: `${m.toUpperCase()} ${path}`, op: item[m], params }))
  })

describe("AC-M0-01 cross-tenant isolation walker", () => {
  test("the walk is not vacuous: parameterised routes exist, every one has fixtures and a body example", () => {
    const ops = operations()
    expect(ops.length).toBeGreaterThanOrEqual(10)
    const problems: string[] = []
    for (const o of ops) {
      const fx = b.fixtures[o.path]
      if (!fx) problems.push(`${o.key}: no entry in ROUTE_PARAMS / route-fixtures.ts`)
      for (const p of o.params) if (!fx?.[p]) problems.push(`${o.key}: no fixture for {${p}}`)
      const body = bodyExample(o.op)
      if (body.present && body.example === undefined) problems.push(`${o.key}: JSON body has no .openapi({ example }) (R5)`)
    }
    for (const path of Object.keys(ROUTE_PARAMS)) if (!doc.paths[path]) problems.push(`stale ROUTE_PARAMS entry ${path}: not in the OpenAPI doc`)
    for (const k of Object.keys(NOT_APPLICABLE)) if (!ops.some((o) => o.key === k)) problems.push(`stale NOT_APPLICABLE entry ${k}`)
    expect(problems).toEqual([])
  })

  test("as owner of A, every route with a path param returns 404 problem+json for tenant B's ids and leaks nothing", async () => {
    const before = await hashes(b.tenant.id)
    const ops = operations()
    const failures: string[] = []
    const walked: string[] = []
    const skipped: string[] = []
    for (const o of ops) {
      const fx = b.fixtures[o.path]
      const hasForeignId = o.params.some((p) => fx[p].kind === "id")
      if (!hasForeignId) {
        skipped.push(o.key)
        continue
      }
      const params = Object.fromEntries(o.params.map((p) => [p, fx[p].value]))
      const body = bodyExample(o.op)
      const send = (url: string) => call(t.app, o.method, url, { cookie: ownerA.cookie, tenant: a.tenant.slug, body: body.present ? body.example : undefined })
      const r = await send(substitute(o.path, params))
      walked.push(o.key)
      const text = await r.text()
      if (r.status !== 404) failures.push(`${o.key} -> ${r.status} (want 404) ${text.slice(0, 120)}`)
      if (!(r.headers.get("content-type") ?? "").startsWith("application/problem+json")) failures.push(`${o.key}: content-type ${r.headers.get("content-type")}`)
      for (const m of b.marks) if (text.includes(m)) failures.push(`${o.key}: 404 body leaks tenant-B value ${m}`)
      // B's id must look exactly like an id that never existed.
      const ghost = Object.fromEntries(o.params.map((p) => [p, fx[p].kind === "id" ? (p === "userId" ? "usr_ghost" : NIL_UUID) : fx[p].value]))
      const g = await send(substitute(o.path, ghost))
      const code = (s: string) => (JSON.parse(s) as Json).code
      if (g.status === 404 && code(await g.text()) !== code(text)) failures.push(`${o.key}: B-id 404 code differs from a never-existing id's`)
    }
    expect(failures).toEqual([])
    expect(walked.length).toBeGreaterThanOrEqual(10)
    expect(walked.length + skipped.length).toBe(ops.length)
    expect(skipped.sort()).toEqual(Object.keys(NOT_APPLICABLE).sort()) // no silent skips
    expect(await hashes(b.tenant.id)).toEqual(before) // nothing of B was written, deleted or audited
  }, 120_000)

  test("control: the same operations with tenant A's OWN ids are not 404 (so the walker really reaches the lookup)", async () => {
    const failures: string[] = []
    for (const o of operations()) {
      if (NOT_APPLICABLE[o.key]) continue
      // fresh records per operation: some calls delete or consume them
      const f = await fixtureIds(t, a.tenant, a.owner, a.staff)
      const w: World = { ...a, ...f }
      const params = Object.fromEntries(o.params.map((p) => [p, f.fixtures[o.path][p].value]))
      const body = bodyExample(o.op)
      const override = CONTROL_BODY(w, o.key)
      // bind is only answerable by the device's allocated user, with a code the owner issued first
      const bind = o.key === "POST /v1/devices/{id}/bind"
      let sendBody = body.present ? (override ?? body.example) : undefined
      if (bind) {
        const issued = await call(t.app, "POST", `/v1/devices/${f.resources.device}/enrolment-code`, { cookie: ownerA.cookie, tenant: a.tenant.slug })
        sendBody = { code: ((await issued.json()) as Json).code }
      }
      const r = await call(t.app, o.method, substitute(o.path, params), { cookie: bind ? a.staff.cookie : ownerA.cookie, tenant: a.tenant.slug, body: sendBody })
      if (r.status === 404 || r.status >= 500) failures.push(`${o.key} -> ${r.status} with A's own ids: ${(await r.text()).slice(0, 120)}`)
    }
    expect(failures).toEqual([])
  }, 120_000)

  test("static-param routes (the explicit exclusions): A's call only ever touches A's rows", async () => {
    const put = (as: Actor, tenant: string, allow: string) => call(t.app, "PUT", "/v1/device-policies/drive", { cookie: as.cookie, tenant, body: { allow } })
    expect((await put(b.owner, b.tenant.slug, "none")).status).toBe(200)
    const before = await hashes(b.tenant.id)
    expect((await put(ownerA, a.tenant.slug, "any")).status).toBe(200)
    expect(await hashes(b.tenant.id)).toEqual(before)
    const rows = await ownerTenantQuery(b.tenant.id, "select allow from device_policies where feature = 'drive'")
    expect(rows.map((r) => r.allow)).toEqual(["none"])
    // and the X-Tenant header cannot be pointed at B by A's owner
    expect((await put(ownerA, b.tenant.slug, "any")).status).toBe(404)
  })

  test("a tenant-scoped GET never returns B's rows to A", async () => {
    for (const path of ["/v1/roles", "/v1/teams", "/v1/devices", "/v1/people", "/v1/audit"]) {
      const r = await call(t.app, "GET", path, { cookie: ownerA.cookie, tenant: a.tenant.slug })
      expect(r.status, path).toBe(200)
      const text = await r.text()
      for (const m of b.marks) expect(text.includes(m), `${path} leaks ${m}`).toBe(false)
    }
  })
})

describe("every /v1 route is registered through OpenAPI (no hidden routes)", () => {
  const EXCLUDED = (p: string) => p.startsWith("/api/auth") || p === "/healthz" || p === "/readyz" || p === "/v1/openapi.json" || p.startsWith("/v1/_probe/")
  test("app.routes minus the documented exclusions equals the OpenAPI paths", () => {
    const app = t.app
    const registered = new Set<string>()
    for (const r of app.routes) {
      if (r.method === "ALL" || EXCLUDED(r.path)) continue
      registered.add(`${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`)
    }
    const documented = new Set<string>()
    for (const [path, item] of Object.entries(doc.paths)) for (const m of METHODS) if (item[m]) documented.add(`${m.toUpperCase()} ${path}`)
    expect(registered.size).toBeGreaterThan(20)
    expect([...registered].filter((k) => !documented.has(k)).sort()).toEqual([])
    expect([...documented].filter((k) => !registered.has(k)).sort()).toEqual([])
  })
  test("the exclusions are real and nothing else under /v1 is hidden", () => {
    const paths = t.app.routes.filter((r) => r.method !== "ALL").map((r) => r.path)
    expect(paths.some((p) => p.startsWith("/v1/_probe/"))).toBe(true)
    expect(paths.filter((p) => p.startsWith("/v1/") && !p.startsWith("/v1/_probe/") && p !== "/v1/openapi.json").length).toBeGreaterThan(20)
  })
})

describe("RLS: own-row read policies cannot widen a tenant-scoped transaction", () => {
  test("with BOTH app.tenant_id=A and app.user_id=<member of A and B> set, memberships and roles show only A's rows", async () => {
    const dual = await makeMember(t.deps, a.tenant.id, "employee")
    await makeMember(t.deps, b.tenant.id, "employee", { email: dual.email }) // same user, second tenant
    const { mem, rol } = await t.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenant.id}, true)`)
      await tx.execute(sql`select set_config('app.user_id', ${dual.userId}, true)`)
      return { mem: await tx.select({ tenantId: memberships.tenantId, userId: memberships.userId }).from(memberships), rol: await tx.select({ tenantId: roles.tenantId }).from(roles) }
    })
    expect(mem.some((m) => m.userId === dual.userId && m.tenantId === a.tenant.id)).toBe(true)
    expect(mem.filter((m) => m.tenantId !== a.tenant.id)).toEqual([])
    expect(rol.length).toBeGreaterThan(0)
    expect(rol.filter((r) => r.tenantId !== a.tenant.id)).toEqual([])
  })
})
