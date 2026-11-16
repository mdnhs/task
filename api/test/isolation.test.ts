import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { call, resetDb, testApp } from "./harness"
import { ownerTenantQuery } from "./db"
import { makeMember, makeTenant, signIn } from "./factories"
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

/**
 * One spec per operation, used by BOTH the B-walk and the control run: the same actor, the same body, only the
 * path ids differ (A's own vs B's). So the only thing that can turn the call into a 404 for B's ids is the tenant
 * boundary. `expect` is the resource-specific 404 code the lookup of the path id throws (any other 404, e.g. a
 * body-role lookup failing first, fails the walker). A route without a spec fails the walker.
 *  - "owner": owner of A.  - "dual": a member of BOTH A and B, the allocated user of a device in A and one in B.
 * `body(w)` gets the world whose ids are in the path (so bind can use a code issued for that very device).
 */
type Spec = { actor: "owner" | "dual"; expect: string; body?: (w: World) => Promise<unknown> | unknown }
const issueCode = async (w: World) => {
  const r = await call(t.app, "POST", `/v1/devices/${w.resources.device}/enrolment-code`, { cookie: w.owner.cookie, tenant: w.tenant.slug })
  if (r.status !== 201) throw new Error(`enrolment code failed: ${r.status}`)
  return { code: ((await r.json()) as Json).code }
}
const SPECS: Record<string, Spec> = {
  "POST /v1/roles/{id}/clone": { actor: "owner", expect: "role_not_found" },
  "PATCH /v1/roles/{id}": { actor: "owner", expect: "role_not_found" },
  // body role is a REAL role of A: role lookup passes in both runs, so only the member lookup can 404
  "PATCH /v1/members/{userId}": { actor: "owner", expect: "member_not_found", body: () => ({ roleId: a.resources.role }) },
  "PUT /v1/members/{userId}/manager": { actor: "owner", expect: "member_not_found", body: () => ({ managerId: null }) },
  "PATCH /v1/teams/{id}": { actor: "owner", expect: "team_not_found" },
  "DELETE /v1/teams/{id}": { actor: "owner", expect: "team_not_found" },
  "PUT /v1/teams/{id}/members": { actor: "owner", expect: "team_not_found", body: () => ({ userIds: [a.resources.member] }) },
  "PATCH /v1/devices/{id}": { actor: "owner", expect: "device_not_found" },
  "POST /v1/devices/{id}/enrolment-code": { actor: "owner", expect: "device_not_found" },
  // actor is the allocated user of the device in BOTH tenants, with a live code issued for that exact device
  "POST /v1/devices/{id}/bind": { actor: "dual", expect: "device_not_found", body: issueCode },
  // the acting owner of A owns the A fixtures; B's ids belong to B's owner (own-notification rule + RLS)
  "POST /v1/notifications/{id}/read": { actor: "owner", expect: "notification_not_found" },
  "DELETE /v1/me/push-tokens/{id}": { actor: "owner", expect: "push_token_not_found" },
  // a pending, never-uploaded file of A: GET 200, complete 409 upload_missing, download 409 file_not_ready, delete 204 (all "not 404")
  "GET /v1/files/{id}": { actor: "owner", expect: "file_not_found" },
  "POST /v1/files/{id}/complete": { actor: "owner", expect: "file_not_found" },
  "GET /v1/files/{id}/download": { actor: "owner", expect: "file_not_found" },
  "DELETE /v1/files/{id}": { actor: "owner", expect: "file_not_found" },
  // the tenant's google connection (control: DELETE -> 204)
  "DELETE /v1/integrations/{id}": { actor: "owner", expect: "integration_not_found" },
}

let t: ReturnType<typeof testApp>
let ownerA: Actor
let dual: Actor
let a: World
let b: World
let doc: { paths: Record<string, Record<string, Json>> }

async function buildWorld(tenant: { id: string; slug: string }, deviceUser?: Actor): Promise<World> {
  const owner = await actorIn(t, tenant, "owner")
  const staff = await actorIn(t, tenant, "employee")
  const f = await fixtureIds(t, tenant, owner, staff, deviceUser)
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
  for (const tbl of ["roles", "memberships", "teams", "team_members", "reporting_lines", "devices", "device_policies", "invites", "audit_events", "tenant_settings", "notifications", "notification_preferences", "push_tokens", "notification_deliveries", "files", "integration_connections", "oauth_states", "public_holidays"]) {
    const [r] = await ownerTenantQuery(tenantId, `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)), '') as h from ${tbl} x`)
    out[tbl] = String(r.h)
  }
  return out
}

beforeAll(async () => {
  await resetDb()
  t = testApp()
  const ta = await makeTenant(t.deps, { slug: "iso-alpha" })
  const tb = await makeTenant(t.deps, { slug: "iso-bravo" })
  // one user in both tenants: signs in once, X-Tenant picks the tenant
  const du = await makeMember(t.deps, ta.id, "employee")
  await makeMember(t.deps, tb.id, "employee", { email: du.email })
  dual = { userId: du.userId, slug: ta.slug, cookie: (await signIn(t.app, du.email, du.password)).cookie }
  a = await buildWorld(ta, dual)
  b = await buildWorld(tb, dual)
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

  test("as A, every route with a path param returns the resource-specific 404 problem+json for tenant B's ids and leaks nothing", async () => {
    const ops = operations()
    const failures: string[] = []
    const skipped: string[] = []
    const plan: { o: Op; spec: Spec; body: unknown; params: Record<string, string>; ghost: Record<string, string> }[] = []
    for (const o of ops) {
      const fx = b.fixtures[o.path]
      if (!o.params.some((p) => fx[p].kind === "id")) {
        skipped.push(o.key)
        continue
      }
      const spec = SPECS[o.key]
      if (!spec) {
        failures.push(`${o.key}: no SPECS entry (actor/body/expected 404 code)`)
        continue
      }
      const ex = bodyExample(o.op)
      const body = ex.present ? await (spec.body ? spec.body(b) : ex.example) : undefined // codes are issued BEFORE the snapshot below
      plan.push({
        o, spec, body,
        params: Object.fromEntries(o.params.map((p) => [p, fx[p].value])),
        ghost: Object.fromEntries(o.params.map((p) => [p, fx[p].kind === "id" ? (p === "userId" ? "usr_ghost" : NIL_UUID) : fx[p].value])),
      })
    }
    const before = await hashes(b.tenant.id)
    const walked: string[] = []
    for (const { o, spec, body, params, ghost } of plan) {
      const cookie = spec.actor === "dual" ? dual.cookie : ownerA.cookie
      const send = (url: string) => call(t.app, o.method, url, { cookie, tenant: a.tenant.slug, body })
      const r = await send(substitute(o.path, params))
      walked.push(o.key)
      const text = await r.text()
      const code = (JSON.parse(text) as Json).code
      if (r.status !== 404) failures.push(`${o.key} -> ${r.status} (want 404) ${text.slice(0, 120)}`)
      else if (code !== spec.expect) failures.push(`${o.key}: 404 code ${code}, want ${spec.expect} (a different lookup failed first)`)
      if (!(r.headers.get("content-type") ?? "").startsWith("application/problem+json")) failures.push(`${o.key}: content-type ${r.headers.get("content-type")}`)
      for (const m of b.marks) if (text.includes(m)) failures.push(`${o.key}: 404 body leaks tenant-B value ${m}`)
      // B's id must look exactly like an id that never existed.
      const g = await send(substitute(o.path, ghost))
      if (g.status !== 404 || ((await g.json()) as Json).code !== spec.expect) failures.push(`${o.key}: never-existing id did not give 404 ${spec.expect}`)
    }
    expect(failures).toEqual([])
    expect(walked.length).toBeGreaterThanOrEqual(10)
    expect(walked.length + skipped.length).toBe(ops.length)
    expect(skipped.sort()).toEqual(Object.keys(NOT_APPLICABLE).sort()) // no silent skips
    expect(Object.keys(SPECS).sort()).toEqual(walked.sort()) // no stale spec
    expect(await hashes(b.tenant.id)).toEqual(before) // nothing of B was written, deleted or audited
  }, 120_000)

  test("control: same actor and body, tenant A's OWN ids: not 404 and not 5xx (so the walk really reaches the lookup)", async () => {
    const failures: string[] = []
    for (const o of operations()) {
      if (NOT_APPLICABLE[o.key]) continue
      const spec = SPECS[o.key]
      if (!spec) {
        failures.push(`${o.key}: no SPECS entry`)
        continue
      }
      // fresh records per operation: some calls delete or consume them
      const f = await fixtureIds(t, a.tenant, a.owner, a.staff, dual)
      const w: World = { ...a, ...f }
      const params = Object.fromEntries(o.params.map((p) => [p, f.fixtures[o.path][p].value]))
      const ex = bodyExample(o.op)
      const body = ex.present ? await (spec.body ? spec.body(w) : ex.example) : undefined
      const r = await call(t.app, o.method, substitute(o.path, params), { cookie: spec.actor === "dual" ? dual.cookie : ownerA.cookie, tenant: a.tenant.slug, body })
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
