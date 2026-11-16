import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerTenantQuery, testDb } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { withTenant } from "../../db/tenant-tx"
import { recordAudit, streamAuditCsv } from "./index"

beforeEach(resetDb)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const m = await makeMember(t.deps, tenant.id, "manager") // audit: write
  const cookie = (await signIn(t.app, m.email, m.password)).cookie
  const seed = (n: number) =>
    withTenant(t.deps.db, tenant.id, async (tx) => {
      for (let i = 0; i < n; i++)
        await recordAudit(tx, tenant.id, { action: "task.updated", entity: i % 2 ? "task" : "role", entityId: `e${i}`, actorId: m.userId, before: { n: i }, after: { n: i + 1 } }, new Date(Date.UTC(2026, 10, 1, 0, i)))
    })
  return { ...t, tenant, m, cookie, seed }
}

test("GET /v1/audit lists newest first and filters by entity and range; needs audit read", async () => {
  const w = await world()
  await w.seed(6)
  const all = (await (await call(w.app, "GET", "/v1/audit", { cookie: w.cookie, tenant: "acme" })).json()) as { entityId: string }[]
  expect(all.map((r) => r.entityId)).toEqual(["e5", "e4", "e3", "e2", "e1", "e0"])
  const tasks = (await (await call(w.app, "GET", "/v1/audit?entity=task", { cookie: w.cookie, tenant: "acme" })).json()) as { entity: string }[]
  expect(tasks.map((r) => r.entity)).toEqual(["task", "task", "task"])
  const ranged = (await (await call(w.app, "GET", "/v1/audit?from=2026-11-01T00:02:00.000Z&to=2026-11-01T00:03:00.000Z", { cookie: w.cookie, tenant: "acme" })).json()) as { entityId: string }[]
  expect(ranged.map((r) => r.entityId)).toEqual(["e3", "e2"])
  const emp = await makeMember(w.deps, w.tenant.id, "employee") // audit: none
  const ec = (await signIn(w.app, emp.email, emp.password)).cookie
  expect((await call(w.app, "GET", "/v1/audit", { cookie: ec, tenant: "acme" })).status).toBe(403)
  expect((await call(w.app, "GET", "/v1/audit?from=nope", { cookie: w.cookie, tenant: "acme" })).status).toBe(400)
})

test("export returns CSV with who, what, when, old and new value and is itself audited", async () => {
  const w = await world()
  await w.seed(2)
  const r = await call(w.app, "GET", "/v1/audit/export?format=csv", { cookie: w.cookie, tenant: "acme" })
  expect(r.status).toBe(200)
  expect(r.headers.get("content-type")).toContain("text/csv")
  const lines = (await r.text()).trimEnd().split("\n")
  expect(lines[0]).toBe("at,actor,action,entity,entity_id,before,after")
  expect(lines).toHaveLength(3)
  expect(lines[1]).toContain(w.m.userId)
  expect(lines[1]).toContain("task.updated")
  expect(lines[1]).toContain("2026-11-01T00:01:00.000Z")
  expect(lines[1]).toContain('"{""n"":1}"')
  const [last] = await ownerTenantQuery(w.tenant.id, "select action, actor_id, entity from audit_events order by seq desc limit 1")
  expect(last).toMatchObject({ action: "audit.exported", actor_id: w.m.userId, entity: "audit" })
})

test("export without audit read is 403 and writes no audit entry", async () => {
  const w = await world()
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const ec = (await signIn(w.app, emp.email, emp.password)).cookie
  const r = await call(w.app, "GET", "/v1/audit/export?format=csv", { cookie: ec, tenant: "acme" })
  expect(r.status).toBe(403)
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from audit_events")).toEqual([])
  expect((await call(w.app, "GET", "/v1/audit/export?format=xml", { cookie: w.cookie, tenant: "acme" })).status).toBe(400)
})

test("export never truncates: more than the 1000-row list limit comes back whole", async () => {
  const w = await world()
  await ownerTenantQuery(
    w.tenant.id,
    `insert into audit_events (id, tenant_id, seq, at, actor_id, action, entity, entity_id, before, after, prev_hash, hash)
     select gen_random_uuid(), $1, g, now(), 'u', 'bulk', 'task', 'e' || g, null, null, 'p', 'h' || g from generate_series(1, 2503) g`,
    [w.tenant.id],
  )
  const r = await call(w.app, "GET", "/v1/audit/export?format=csv", { cookie: w.cookie, tenant: "acme" })
  const lines = (await r.text()).trimEnd().split("\n")
  expect(lines).toHaveLength(2504) // header + 2503
  expect(new Set(lines.slice(1).map((l) => l.split(",")[4])).size).toBe(2503)
})

test("streamAuditCsv pages through every row, newest first, honouring the filter and an upper bound", async () => {
  const w = await world()
  await w.seed(25)
  const read = async (s: ReadableStream<Uint8Array>) => new Response(s).text()
  const csv = await read(streamAuditCsv(testDb(), w.tenant.id, {}, { pageSize: 10 }))
  const ids = csv.trimEnd().split("\n").slice(1).map((l) => l.split(",")[4])
  expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => `e${24 - i}`))
  const roles = await read(streamAuditCsv(testDb(), w.tenant.id, { entity: "role" }, { pageSize: 4 }))
  expect(roles.trimEnd().split("\n")).toHaveLength(1 + 13)
  const bounded = await read(streamAuditCsv(testDb(), w.tenant.id, {}, { pageSize: 10, upToSeq: 12 }))
  expect(bounded.trimEnd().split("\n")).toHaveLength(1 + 12)
})
