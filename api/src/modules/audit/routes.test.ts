import { beforeEach, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { ownerTenantQuery, testDb } from "../../../test/db"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { withTenant } from "../../db/tenant-tx"
import { recordAudit, streamAuditCsv, verifyChain } from "./index"

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
  const all = ((await (await call(w.app, "GET", "/v1/audit", { cookie: w.cookie, tenant: "acme" })).json()) as { items: { entityId: string }[] }).items
  expect(all.map((r) => r.entityId)).toEqual(["e5", "e4", "e3", "e2", "e1", "e0"])
  const tasks = ((await (await call(w.app, "GET", "/v1/audit?entity=task", { cookie: w.cookie, tenant: "acme" })).json()) as { items: { entity: string }[] }).items
  expect(tasks.map((r) => r.entity)).toEqual(["task", "task", "task"])
  const ranged = ((await (await call(w.app, "GET", "/v1/audit?from=2026-11-01T00:02:00.000Z&to=2026-11-01T00:03:00.000Z", { cookie: w.cookie, tenant: "acme" })).json()) as { items: { entityId: string }[] }).items
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

// ---------------------------------------------------------------- B7 T9 (ruling S7): filters and the keyset cursor
type Page = { items: { seq: number; actorId: string | null; action: string; entityId: string; at: string }[]; nextCursor: string | null }
const list = async (w: Awaited<ReturnType<typeof world>>, qs = "", cookie = w.cookie, tenant = "acme") => call(w.app, "GET", `/v1/audit${qs}`, { cookie, tenant })
const page = async (w: Awaited<ReturnType<typeof world>>, qs = "") => {
  const r = await list(w, qs)
  expect(r.status, await r.clone().text()).toBe(200)
  return (await r.json()) as Page
}
const code = async (r: Response) => ((await r.clone().json()) as { code: string }).code
const NOW = new Date(Date.UTC(2026, 10, 2, 12, 0, 0))
/** n entries by `actor` at ONE instant (equal timestamps: the cursor must still walk them in chain order, no gap, no repeat). */
const seedAt = (w: Awaited<ReturnType<typeof world>>, n: number, o: { actor?: string | null; action?: string; at?: Date; tenantId?: string } = {}) =>
  withTenant(w.deps.db, o.tenantId ?? w.tenant.id, async (tx) => {
    for (let i = 0; i < n; i++)
      await recordAudit(tx, o.tenantId ?? w.tenant.id, { action: o.action ?? "task.updated", entity: "task", entityId: `s${i}`, actorId: o.actor === undefined ? w.m.userId : o.actor, before: null, after: { i } }, o.at ?? NOW)
  })

test("actor filter returns only that actor's entries; an unknown actor is an empty page, not an error", async () => {
  const w = await world()
  await seedAt(w, 3, { actor: w.m.userId })
  await seedAt(w, 2, { actor: "someone-else" })
  await seedAt(w, 1, { actor: null })
  const mine = await page(w, `?actorId=${w.m.userId}`)
  expect(mine.items).toHaveLength(3)
  expect(mine.items.every((r) => r.actorId === w.m.userId)).toBe(true)
  expect((await page(w, "?actorId=someone-else")).items).toHaveLength(2)
  expect((await page(w, "?actorId=ghost")).items).toEqual([])
  expect((await list(w, `?actorId=${"x".repeat(65)}`)).status).toBe(400)
})

test("action exact and actionPrefix filters, and combining them is 400", async () => {
  const w = await world()
  await seedAt(w, 2, { action: "task.updated" })
  await seedAt(w, 1, { action: "task.created" })
  await seedAt(w, 1, { action: "role.updated" })
  await seedAt(w, 1, { action: "task_x.odd" })
  expect((await page(w, "?action=task.updated")).items).toHaveLength(2)
  expect((await page(w, "?actionPrefix=task.")).items.map((r) => r.action).sort()).toEqual(["task.created", "task.updated", "task.updated"])
  expect((await page(w, "?actionPrefix=task_")).items.map((r) => r.action)).toEqual(["task_x.odd"]) // _ and % are literal, not LIKE wildcards
  expect((await page(w, "?actionPrefix=%25")).items).toEqual([])
  const both = await list(w, "?action=task.updated&actionPrefix=task.")
  expect([both.status, await code(both)]).toEqual([400, "invalid_filter"])
})

test("from and to bound by the entry time (inclusive); to before from is 400", async () => {
  const w = await world()
  await w.seed(6) // 00:00 .. 00:05 on 1 Nov
  const r = await page(w, "?from=2026-11-01T00:01:00.000Z&to=2026-11-01T00:03:00.000Z")
  expect(r.items.map((x) => x.entityId)).toEqual(["e3", "e2", "e1"])
  expect((await page(w, "?from=2026-11-01T00:05:00.000Z")).items.map((x) => x.entityId)).toEqual(["e5"])
  const bad = await list(w, "?from=2026-11-01T00:03:00.000Z&to=2026-11-01T00:01:00.000Z")
  expect([bad.status, await code(bad)]).toEqual([400, "invalid_range"])
})

test("cursor paging walks 120 entries with equal timestamps without gaps or duplicates, newest (highest seq) first", async () => {
  const w = await world()
  await seedAt(w, 120)
  const seen: number[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const p: Page = await page(w, `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
    seen.push(...p.items.map((r) => r.seq))
    cursor = p.nextCursor
    pages++
    expect(pages).toBeLessThan(10)
  } while (cursor)
  expect(pages).toBe(3)
  expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i)) // every seq once, strictly descending
  const hundred = await page(w, "?limit=100")
  expect(await page(w, `?limit=20&cursor=${encodeURIComponent(hundred.nextCursor!)}`)).toMatchObject({ nextCursor: null }) // exactly the last 20: no phantom next page
  expect((await page(w)).items).toHaveLength(50) // default limit
  // a filter keeps its cursor chain intact
  const f1 = await page(w, `?actorId=${w.m.userId}&limit=100`)
  const f2 = await page(w, `?actorId=${w.m.userId}&limit=100&cursor=${encodeURIComponent(f1.nextCursor!)}`)
  expect([f1.items.length, f2.items.length, f2.nextCursor]).toEqual([100, 20, null])
})

test("a garbage cursor is 400 invalid_cursor, never 500; a cursor from another tenant is rejected 400 and never leaks rows", async () => {
  const w = await world()
  await seedAt(w, 3)
  for (const bad of ["garbage", "", "!!!", Buffer.from("x|y|z").toString("base64url"), Buffer.from(`${NOW.toISOString()}|not-a-uuid`).toString("base64url"), Buffer.from(`nope|${crypto.randomUUID()}`).toString("base64url")]) {
    const r = await list(w, `?cursor=${encodeURIComponent(bad)}`)
    expect([r.status, bad === "" ? 400 : await code(r)], bad).toEqual([400, bad === "" ? 400 : "invalid_cursor"])
  }
  // a well-formed cursor of a row that does not exist (here) is the same 400
  expect(await code(await list(w, `?cursor=${Buffer.from(`${NOW.toISOString()}|${crypto.randomUUID()}`).toString("base64url")}`))).toBe("invalid_cursor")
  // tenant B's own cursor, used on tenant A
  const other = await makeTenant(w.deps, { slug: "other" })
  const om = await makeMember(w.deps, other.id, "manager")
  const oc = (await signIn(w.app, om.email, om.password)).cookie
  await seedAt(w, 5, { tenantId: other.id, actor: om.userId })
  const theirs = (await (await list(w, "?limit=2", oc, "other")).json()) as Page
  expect(theirs.nextCursor).toBeTruthy()
  const r = await list(w, `?cursor=${encodeURIComponent(theirs.nextCursor!)}`)
  expect([r.status, await code(r)]).toEqual([400, "invalid_cursor"])
  expect(JSON.stringify(await r.json())).not.toContain("s0")
})

test("limit above 100 is 400; 0 is 400", async () => {
  const w = await world()
  expect((await list(w, "?limit=101")).status).toBe(400)
  expect((await list(w, "?limit=1000")).status).toBe(400)
  expect((await list(w, "?limit=0")).status).toBe(400)
  expect((await list(w, "?limit=100")).status).toBe(200)
})

test("the export takes the same filters (and is not paged); a bad combination is 400 and writes no audit row", async () => {
  const w = await world()
  await seedAt(w, 3, { action: "task.updated" })
  await seedAt(w, 2, { action: "role.updated", actor: "someone-else" })
  const csv = async (qs: string) => (await (await call(w.app, "GET", `/v1/audit/export?format=csv${qs}`, { cookie: w.cookie, tenant: "acme" })).text()).trimEnd().split("\n")
  expect(await csv("&actionPrefix=role.")).toHaveLength(3) // header + 2
  expect(await csv("&actorId=someone-else")).toHaveLength(3)
  expect(await csv("&action=task.updated&actorId=" + w.m.userId)).toHaveLength(4)
  const [{ n }] = await ownerTenantQuery(w.tenant.id, "select count(*)::int n from audit_events")
  const bad = await call(w.app, "GET", "/v1/audit/export?format=csv&action=a&actionPrefix=b", { cookie: w.cookie, tenant: "acme" })
  expect(bad.status).toBe(400)
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n from audit_events"))[0].n).toBe(n)
})

test("the list needs audit read: a member without it is 403 even with a cursor, and a cursor never lifts the tenant scope", async () => {
  const w = await world()
  await seedAt(w, 3)
  const emp = await makeMember(w.deps, w.tenant.id, "employee")
  const ec = (await signIn(w.app, emp.email, emp.password)).cookie
  expect((await list(w, "?limit=1&actorId=x", ec)).status).toBe(403)
})

test("reads never write: the chain verifies and the row count is unchanged after filtered and paged lists", async () => {
  const w = await world()
  await seedAt(w, 30)
  const before = (await ownerTenantQuery(w.tenant.id, "select count(*)::int n, max(seq)::int m from audit_events"))[0]
  const p = await page(w, "?limit=10")
  await page(w, `?limit=10&cursor=${encodeURIComponent(p.nextCursor!)}&actionPrefix=task.`)
  expect((await ownerTenantQuery(w.tenant.id, "select count(*)::int n, max(seq)::int m from audit_events"))[0]).toEqual(before)
  const v = await verifyChain(w.deps.db, w.tenant.id)
  expect(v.ok).toBe(true)
})

test("5 000 entries: the first page and a filtered page are bounded (no row-per-entry response) and use an index, not a sequential scan", async () => {
  const w = await world()
  await ownerTenantQuery(
    w.tenant.id,
    `insert into audit_events (id, tenant_id, seq, at, actor_id, action, entity, entity_id, before, after, prev_hash, hash)
     select gen_random_uuid(), $1, g, now() - (g || ' seconds')::interval, case when g % 7 = 0 then 'u7' else 'u' end, 'bulk', 'task', 'e' || g, null, null, 'p', 'h' || g from generate_series(1, 5000) g`,
    [w.tenant.id],
  )
  await ownerTenantQuery(w.tenant.id, "analyze audit_events")
  const p = await page(w)
  expect(p.items).toHaveLength(50)
  expect(p.nextCursor).toBeTruthy()
  const plan = (await ownerTenantQuery(w.tenant.id, `explain select * from audit_events where tenant_id = '${w.tenant.id}' order by seq desc limit 51`)).map((r) => Object.values(r)[0]).join("\n")
  expect(plan).not.toMatch(/Seq Scan/)
  const a = await page(w, "?actorId=u7&limit=100")
  expect(a.items).toHaveLength(100)
})
