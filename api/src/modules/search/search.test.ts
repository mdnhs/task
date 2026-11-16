import { beforeEach, afterEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { publish, relayOnce, resetSubscribers } from "../../core/events"
import { withTenant } from "../../db/tenant-tx"
import { indexDocument, registerSearchIndexers, removeDocument, removeDocumentsForUser } from "."

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerSearchIndexers()
})
afterEach(resetSubscribers)

async function world() {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { slug: "acme" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const employee = await makeMember(t.deps, tenant.id, "employee")
  const hr = await makeMember(t.deps, tenant.id, "hr") // files only: no staff, no settings
  const ck = async (m: { email: string; password: string }) => (await signIn(t.app, m.email, m.password)).cookie
  const co = await ck(owner)
  const ce = await ck(employee)
  const ch = await ck(hr)
  const search = async (cookie: string, q: string, extra = "", slug = tenant.slug) => call(t.app, "GET", `/v1/search?q=${encodeURIComponent(q)}${extra}`, { cookie, tenant: slug })
  const titles = async (cookie: string, q: string) => (((await (await search(cookie, q)).json()) as Json).hits as Json[]).map((h) => h.title)
  const relay = async () => {
    for (let i = 0; i < 5 && (await relayOnce(t.deps)) > 0; i++);
  }
  const setName = (userId: string, name: string) => ownerQuery(`update "user" set name = $1 where id = $2`, [name, userId])
  const joined = (userId: string) => withTenant(t.deps.db, tenant.id, (tx) => publish(tx, { tenantId: tenant.id, type: "member.joined", payload: { userId }, actorId: userId }, t.deps.clock.now()))
  const docs = () => ownerTenantQuery(tenant.id, "select entity, entity_id, module, title, body from search_documents order by entity, title") as Promise<Json[]>
  return { ...t, tenant, owner, employee, hr, co, ce, ch, search, titles, relay, setName, joined, docs }
}

test("search finds a member by partial name (prefix and trigram), never by email", async () => {
  const w = await world()
  await w.setName(w.employee.userId, "Alexandra Johnson")
  await w.joined(w.employee.userId)
  await w.relay()
  expect(await w.titles(w.co, "alexa")).toEqual(["Alexandra Johnson"]) // prefix on the last token
  expect(await w.titles(w.co, "ALEXANDRA john")).toEqual(["Alexandra Johnson"]) // all tokens, last is a prefix
  expect(await w.titles(w.co, "johnsno")).toEqual(["Alexandra Johnson"]) // typo: trigram fallback
  expect(await w.titles(w.co, w.employee.email.split("@")[0])).toEqual([]) // emails are not indexed
  const hit = (((await (await w.search(w.co, "alexa")).json()) as Json).hits as Json[])[0]
  expect(hit).toEqual({ entity: "member", entityId: w.employee.userId, title: "Alexandra Johnson", module: "staff" })
})

test("search hides modules the role cannot read", async () => {
  const w = await world()
  await w.setName(w.employee.userId, "Kitchen Person")
  await w.joined(w.employee.userId)
  const team = (await (await call(w.app, "POST", "/v1/teams", { cookie: w.co, tenant: w.tenant.slug, body: { name: "Kitchen crew" } })).json()) as Json
  await withTenant(w.deps.db, w.tenant.id, (tx) => indexDocument(tx, { tenantId: w.tenant.id, entity: "file", entityId: crypto.randomUUID(), module: "files", title: "Kitchen rota.pdf", body: "" }, w.deps.clock.now()))
  await w.relay()
  expect((await w.titles(w.co, "kitchen")).sort()).toEqual(["Kitchen Person", "Kitchen crew", "Kitchen rota.pdf"])
  expect(await w.titles(w.ch, "kitchen")).toEqual(["Kitchen rota.pdf"]) // hr: files only
  expect(await w.titles(w.ce, "kitchen")).toEqual([]) // employee: nothing readable
  expect(team.name).toBe("Kitchen crew")
})

test("search never returns another tenant's documents even with identical text", async () => {
  const w = await world()
  const other = await makeTenant(w.deps, { slug: "other" })
  const id = crypto.randomUUID()
  const idB = crypto.randomUUID()
  await withTenant(w.deps.db, w.tenant.id, (tx) => indexDocument(tx, { tenantId: w.tenant.id, entity: "team", entityId: id, module: "settings", title: "Shared Name", body: "" }, w.deps.clock.now()))
  await withTenant(w.deps.db, other.id, (tx) => indexDocument(tx, { tenantId: other.id, entity: "team", entityId: idB, module: "settings", title: "Shared Name", body: "" }, w.deps.clock.now()))
  const hits = ((await (await w.search(w.co, "shared name")).json()) as Json).hits as Json[]
  expect(hits.map((h) => h.entityId)).toEqual([id])
  // the app role cannot see the other tenant's row even if it asks for it by key
  const leaked = await withTenant(w.deps.db, w.tenant.id, (tx) => tx.execute(`select 1 from search_documents where entity_id = '${idB}'` as never))
  expect((leaked as unknown as { rows: unknown[] }).rows).toHaveLength(0)
})

test("q must be 2..100 chars after trim (422 invalid_query); limit is capped at 20; syntax never 500s", async () => {
  const w = await world()
  for (const q of ["a", "  a ", "", "x".repeat(101)]) {
    const res = await w.search(w.co, q)
    expect(res.status).toBe(422)
    expect(((await res.json()) as Json).code).toBe("invalid_query")
  }
  expect((await call(w.app, "GET", "/v1/search", { cookie: w.co, tenant: w.tenant.slug })).status).toBe(422)
  await withTenant(w.deps.db, w.tenant.id, async (tx) => {
    for (let i = 0; i < 25; i++) await indexDocument(tx, { tenantId: w.tenant.id, entity: "team", entityId: crypto.randomUUID(), module: "settings", title: `Crew ${i}`, body: "" }, w.deps.clock.now())
  })
  const many = ((await (await w.search(w.co, "crew", "&limit=100")).json()) as Json).hits as Json[]
  expect(many).toHaveLength(20)
  expect((((await (await w.search(w.co, "crew", "&limit=3")).json()) as Json).hits as Json[])).toHaveLength(3)
  expect((((await (await w.search(w.co, "crew")).json()) as Json).hits as Json[])).toHaveLength(10) // default
  expect((((await (await w.search(w.co, "crew", "&limit=0")).json()) as Json).hits as Json[]).length).toBeGreaterThan(0) // clamped up, not an error
  for (const q of ["a:* | !b & (c", "'; drop table x; --", "\\\\ ' \" <-> ((", "!!", "crew & | :*", "名前 テスト"]) {
    const res = await w.search(w.co, q)
    expect(res.status, q).toBe(200)
  }
})

test("removing a member removes their document (and GDPR erase removes their files' documents)", async () => {
  const w = await world()
  await w.setName(w.employee.userId, "Dana Quill")
  await w.joined(w.employee.userId)
  await w.relay()
  expect(await w.titles(w.co, "dana")).toEqual(["Dana Quill"])
  await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "member.removed", payload: { userId: w.employee.userId }, actorId: w.owner.userId }, w.deps.clock.now()))
  await w.relay()
  expect(await w.titles(w.co, "dana")).toEqual([])

  // removeDocumentsForUser: member doc + documents of files the user owns
  await w.joined(w.employee.userId)
  const fileId = crypto.randomUUID()
  await ownerTenantQuery(w.tenant.id, `insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, created_at) values ($1,$2,$3,$4,'dana-cv.pdf','application/pdf',10,'clean',now())`, [fileId, w.tenant.id, w.employee.userId, `t/${w.tenant.id}/${fileId}`])
  await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "file.scanned", payload: { fileId, status: "clean" }, actorId: null }, w.deps.clock.now()))
  await w.relay()
  expect((await w.docs()).map((d) => d.entity).sort()).toEqual(["file", "member"])
  await withTenant(w.deps.db, w.tenant.id, (tx) => removeDocumentsForUser(tx, w.tenant.id, w.employee.userId))
  expect(await w.docs()).toEqual([])
})

test("teams are indexed on create/update and removed on delete", async () => {
  const w = await world()
  const req = (method: string, path: string, body?: unknown) => call(w.app, method, path, { cookie: w.co, tenant: w.tenant.slug, body })
  const team = (await (await req("POST", "/v1/teams", { name: "Bakery", kind: "department" })).json()) as Json
  await w.relay()
  expect(await w.titles(w.co, "bake")).toEqual(["Bakery"])
  expect((await w.docs())[0]).toMatchObject({ entity: "team", module: "settings", body: "department" })
  await req("PATCH", `/v1/teams/${team.id}`, { name: "Patisserie" })
  await w.relay()
  expect(await w.titles(w.co, "bake")).toEqual([])
  expect(await w.titles(w.co, "patis")).toEqual(["Patisserie"])
  await req("DELETE", `/v1/teams/${team.id}`)
  await w.relay()
  expect(await w.docs()).toEqual([])
})

test("files are indexed only when clean and removed when infected or deleted", async () => {
  const w = await world()
  const mk = async (name: string, status: string) => {
    const id = crypto.randomUUID()
    await ownerTenantQuery(w.tenant.id, `insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, signature, created_at) values ($1,$2,$3,$4,$5,'application/pdf',10,$6,$7,now())`, [id, w.tenant.id, w.owner.userId, `t/${w.tenant.id}/${id}`, name, status, status === "infected" ? "Eicar" : null])
    return id
  }
  const ev = (type: "file.scanned" | "file.deleted", fileId: string, status?: string) => withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type, payload: { fileId, ...(status ? { status } : {}) }, actorId: null }, w.deps.clock.now()))
  const clean = await mk("Handbook.pdf", "clean")
  const pending = await mk("Pending.pdf", "pending")
  const bad = await mk("Virus.pdf", "infected")
  await ev("file.scanned", clean, "clean")
  await ev("file.scanned", pending, "clean") // stale event: the row is not clean, so it is not indexed
  await ev("file.scanned", bad, "infected")
  await w.relay()
  expect((await w.docs()).map((d) => d.title)).toEqual(["Handbook.pdf"]) // pending and infected never indexed
  expect(await w.titles(w.co, "handbook")).toEqual(["Handbook.pdf"])
  expect(await w.titles(w.co, "pending")).toEqual([])
  await ownerTenantQuery(w.tenant.id, "update files set status = 'deleted' where id = $1", [clean])
  await ev("file.deleted", clean)
  await w.relay()
  expect(await w.docs()).toEqual([])
})

test("indexDocument upserts and removeDocument deletes", async () => {
  const w = await world()
  const id = crypto.randomUUID()
  const doc = { tenantId: w.tenant.id, entity: "team", entityId: id, module: "settings" as const, body: "" }
  await withTenant(w.deps.db, w.tenant.id, async (tx) => {
    await indexDocument(tx, { ...doc, title: "First" }, w.deps.clock.now())
    await indexDocument(tx, { ...doc, title: "Second" }, w.deps.clock.now())
  })
  expect((await w.docs()).map((d) => d.title)).toEqual(["Second"])
  await withTenant(w.deps.db, w.tenant.id, (tx) => removeDocument(tx, w.tenant.id, "team", id))
  expect(await w.docs()).toEqual([])
})
