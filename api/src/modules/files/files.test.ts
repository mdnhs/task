import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { beforeEach, afterEach, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { call, putObject, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import type { MalwareScanner } from "../../core/scan/scanner"
import { fakeScanner } from "../../core/scan/fake-scanner"
import { registerNotifications } from "../notifications"
import { ALLOWED_MIMES, isScopedPurpose, registerFiles } from "."
import { fileKey, stagingKey } from "../../core/storage/storage"

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
const PDF = "application/pdf"

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
})
afterEach(resetSubscribers)

const q = <R = Record<string, unknown>>(tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params) as Promise<R[]>

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps)
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const staff = await makeMember(t.deps, tenant.id, "employee") // files: none
  const reader = await makeMember(t.deps, tenant.id, "admin") // files: read
  const co = (await signIn(t.app, owner.email, owner.password)).cookie
  const cs = (await signIn(t.app, staff.email, staff.password)).cookie
  const cr = (await signIn(t.app, reader.email, reader.password)).cookie
  return { ...t, tenant, owner, staff, co, cs, cr }
}
type W = Awaited<ReturnType<typeof world>>
type Upload = { method: "PUT"; url: string; headers: Record<string, string> }
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const req = (w: W, method: string, path: string, cookie = w.co, body?: unknown) => call(w.app, method, path, { cookie, tenant: w.tenant.slug, body })
const intent = (w: W, body: unknown, cookie = w.co) => req(w, "POST", "/v1/files/uploads", cookie, body)

/** Browser-style PUT to the presigned URL with the headers the API returned (overridable to prove they are signed). */
async function put(up: Upload, content: Buffer | string, o: { headers?: Record<string, string>; url?: string } = {}): Promise<Response> {
  const { "Content-Length": _len, ...headers } = up.headers // fetch sets Content-Length itself from the body
  return fetch(o.url ?? up.url, { method: "PUT", headers: { ...headers, ...o.headers }, body: Buffer.from(content) })
}
const keyOfUrl = (url: string) => /(u\/[0-9a-f-]{36}\/[0-9a-f-]{36})/.exec(url)![1]

/** Full happy path up to (and including) the object being in storage; returns the file id. */
async function stage(w: W, content: Buffer | string, o: { name?: string; mime?: string } = {}) {
  const buf = Buffer.from(content)
  const r = await intent(w, { name: o.name ?? "report.pdf", mime: o.mime ?? PDF, sizeBytes: buf.length })
  expect(r.status).toBe(201)
  const j = (await r.json()) as { fileId: string; upload: Upload }
  const up = await put(j.upload, buf)
  expect(up.status).toBe(200)
  return { id: j.fileId, upload: j.upload, buf }
}
const complete = (w: W, id: string, cookie = w.co) => req(w, "POST", `/v1/files/${id}/complete`, cookie)
const download = (w: W, id: string, cookie = w.co) => call(w.app, "GET", `/v1/files/${id}/download`, { cookie, tenant: w.tenant.slug })
const drain = async (w: W) => {
  for (let i = 0; i < 5 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const rowOf = async (w: W, id: string) => (await q(w.tenant.id, "select * from files where id = $1", [id]))[0]
const scanned = async (w: W, content: Buffer | string, o: { name?: string; mime?: string } = {}) => {
  const s = await stage(w, content, o)
  expect((await complete(w, s.id)).status).toBe(200)
  await drain(w)
  return s
}

test("upload intent returns a presigned PUT to the staging key u/<tenant>/<fileId> expiring in 300 s with Content-Type and Content-Length signed", async () => {
  const w = await world()
  const r = await intent(w, { name: "report.pdf", mime: PDF, sizeBytes: 1234 })
  expect(r.status).toBe(201)
  const j = (await r.json()) as { fileId: string; upload: Upload }
  const key = `t/${w.tenant.id}/${j.fileId}`
  expect(j.upload.method).toBe("PUT")
  expect(j.upload.headers).toEqual({ "Content-Type": PDF, "Content-Length": "1234" })
  const u = new URL(j.upload.url)
  expect(keyOfUrl(j.upload.url)).toBe(`u/${w.tenant.id}/${j.fileId}`) // uploads only ever name the staging key
  expect(j.upload.url).not.toContain(key) // the final key never appears in any upload URL
  expect(u.searchParams.get("X-Amz-Expires")).toBe("300")
  const signed = (u.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";")
  expect(signed).toContain("content-type")
  expect(signed).toContain("content-length")
  const row = await rowOf(w, j.fileId)
  expect(row).toMatchObject({ key, status: "pending", name: "report.pdf", mime: PDF, owner_user_id: w.owner.userId })
  expect(Number(row.size_bytes)).toBe(1234)
  expect(JSON.stringify(j)).not.toContain(w.tenant.slug)
})

test("the presigned PUT really works against storage and rejects a different Content-Type, length or key", async () => {
  const w = await world()
  const r = await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 10 })
  const j = (await r.json()) as { fileId: string; upload: Upload }
  const { upload } = j
  expect((await put(upload, "x".repeat(10), { headers: { "Content-Type": "text/html" } })).status).toBe(403) // signed type differs
  expect((await put(upload, "x".repeat(11))).status).toBe(403) // signed length differs
  expect((await put(upload, "x".repeat(5))).status).toBe(403)
  expect((await put(upload, "x".repeat(10), { url: upload.url.replace(`/u/${w.tenant.id}/`, `/t/${w.tenant.id}/`) })).status).toBe(403) // the key is part of the signature
  expect((await put(upload, "x".repeat(10), { url: upload.url.replace(j.fileId, crypto.randomUUID()) })).status).toBe(403)
  expect(await w.deps.storage.head(`u/${w.tenant.id}/${j.fileId}`)).toBeNull()
  expect((await put(upload, "x".repeat(10))).status).toBe(200)
  expect(await w.deps.storage.head(fileKey(w.tenant.id, j.fileId))).toBeNull() // nothing at the final key until complete
})

test("intent validation: mime allow-list (no svg/html/zip/js/exe), size limit, bad bodies", async () => {
  const w = await world()
  for (const mime of ["image/svg+xml", "text/html", "application/zip", "application/javascript", "application/x-msdownload", "application/octet-stream", "text/plain; charset=utf-8"]) {
    const r = await intent(w, { name: "x", mime, sizeBytes: 5 })
    expect(r.status, mime).toBe(422)
    expect(((await r.json()) as Json).code).toBe("mime_not_allowed")
  }
  for (const mime of ["image/png", "image/jpeg", "image/webp", "image/heic", PDF, "text/csv", "text/plain"]) {
    expect((await intent(w, { name: "x", mime, sizeBytes: 5 })).status, mime).toBe(201)
  }
  expect(ALLOWED_MIMES.some((m) => /svg|html|zip|javascript|exe|msdownload/.test(m))).toBe(false)
  const big = await intent(w, { name: "x.pdf", mime: PDF, sizeBytes: w.deps.env.FILE_MAX_BYTES + 1 })
  expect(big.status).toBe(422)
  expect(((await big.json()) as Json).code).toBe("file_too_large")
  expect((await intent(w, { name: "x.pdf", mime: PDF, sizeBytes: w.deps.env.FILE_MAX_BYTES })).status).toBe(201)
  for (const bad of [{ name: "", mime: PDF, sizeBytes: 5 }, { name: "a\nb", mime: PDF, sizeBytes: 5 }, { name: "x", mime: PDF, sizeBytes: 0 }, { name: "x", mime: PDF, sizeBytes: 1.5 }, { name: "x".repeat(256), mime: PDF, sizeBytes: 5 }, { name: "x", mime: PDF }]) {
    expect((await intent(w, bad)).status, JSON.stringify(bad)).toBe(400)
  }
})

test("complete rejects (and deletes the staging object) when the stored object's size or content-type differs from the intent (422 upload_mismatch)", async () => {
  const w = await world()
  // size: written straight to storage (bypassing the signed PUT) with 10 bytes while the intent says 20
  const r1 = await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 20 })
  const j1 = (await r1.json()) as { fileId: string }
  await putObject(stagingKey(w.tenant.id, j1.fileId), Buffer.alloc(10, 1), PDF)
  const c1 = await complete(w, j1.fileId)
  expect(c1.status).toBe(422)
  expect(((await c1.json()) as Json).code).toBe("upload_mismatch")
  expect((await rowOf(w, j1.fileId)).status).toBe("pending")
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, j1.fileId))).toBeNull()
  expect(await w.deps.storage.head(fileKey(w.tenant.id, j1.fileId))).toBeNull()
  expect(w.queue.jobs).toHaveLength(0)
  // content-type
  const r2 = await intent(w, { name: "b.pdf", mime: PDF, sizeBytes: 5 })
  const j2 = (await r2.json()) as { fileId: string }
  await putObject(stagingKey(w.tenant.id, j2.fileId), Buffer.from("hello"), "text/html")
  const c2 = await complete(w, j2.fileId)
  expect(c2.status).toBe(422)
  expect(((await c2.json()) as Json).code).toBe("upload_mismatch")
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, j2.fileId))).toBeNull()
  // over FILE_MAX_BYTES even if it equals a (tampered) declared size
  const big = await world({ env: { ...testEnv, FILE_MAX_BYTES: 8 } })
  const r3 = await intent(big, { name: "c.pdf", mime: PDF, sizeBytes: 8 })
  const j3 = (await r3.json()) as { fileId: string }
  await putObject(stagingKey(big.tenant.id, j3.fileId), Buffer.alloc(9, 1), PDF)
  expect((await complete(big, j3.fileId)).status).toBe(422)
})

test("complete before any upload is 409 upload_missing", async () => {
  const w = await world()
  const j = (await (await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 5 })).json()) as { fileId: string }
  const c = await complete(w, j.fileId)
  expect(c.status).toBe(409)
  expect(((await c.json()) as Json).code).toBe("upload_missing")
})

test("complete keeps status pending, queues file.scan once, publishes file.uploaded once, and is idempotent", async () => {
  const w = await world()
  const s = await stage(w, "hello pdf")
  const c1 = await complete(w, s.id)
  expect(c1.status).toBe(200)
  expect(((await c1.json()) as Json).status).toBe("pending")
  const c2 = await complete(w, s.id)
  expect(c2.status).toBe(200)
  expect(((await c2.json()) as Json).status).toBe("pending")
  const scans = w.queue.jobs.filter((j) => j.name === "file.scan")
  expect(scans).toHaveLength(2) // a repeat while pending re-queues a scan (own nonce id; the scan itself is a no-op once decided)
  expect(new Set(scans.map((j) => j.opts?.jobId)).size).toBe(2)
  expect(scans[0].data).toMatchObject({ fileId: s.id, tenantId: w.tenant.id })
  expect(scans[0].opts?.jobId).toMatch(/^[A-Za-z0-9._-]+$/)
  const ev = await q(w.tenant.id, "select type, payload from domain_events where type = 'file.uploaded'")
  expect(ev).toHaveLength(1)
  expect(ev[0].payload).toMatchObject({ fileId: s.id, mime: PDF, sizeBytes: s.buf.length })
})

test("no download link before clean scan: pending is 409 file_not_ready", async () => {
  const w = await world()
  const intentOnly = (await (await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 5 })).json()) as { fileId: string }
  const r0 = await download(w, intentOnly.fileId)
  expect(r0.status).toBe(409)
  expect(((await r0.json()) as Json).code).toBe("file_not_ready")
  const s = await stage(w, "hello pdf")
  await complete(w, s.id) // scan job queued but not run
  const r = await download(w, s.id)
  expect(r.status).toBe(409)
  expect(((await r.json()) as Json).code).toBe("file_not_ready")
  expect(r.headers.get("location")).toBeNull()
})

test("clean file: scan sets clean+sha256, publishes file.scanned, writes no audit; download redirects to a 60 s presigned GET for the same key", async () => {
  const w = await world()
  const s = await scanned(w, "hello clean pdf", { name: "Quarterly résumé (final).pdf" })
  const row = await rowOf(w, s.id)
  expect(row.status).toBe("clean")
  expect(row.sha256).toBe(createHash("sha256").update(s.buf).digest("hex"))
  expect(row.scanned_at).not.toBeNull()
  expect(row.signature).toBeNull()
  expect(await q(w.tenant.id, "select 1 from audit_events where action like 'file.%'")).toEqual([])
  const ev = await q(w.tenant.id, "select payload from domain_events where type = 'file.scanned'")
  expect(ev).toHaveLength(1)
  expect(ev[0].payload).toMatchObject({ fileId: s.id, status: "clean" })

  const meta = await req(w, "GET", `/v1/files/${s.id}`)
  expect(meta.status).toBe(200)
  const mj = (await meta.json()) as Json
  expect(mj).toMatchObject({ id: s.id, status: "clean", name: "Quarterly résumé (final).pdf", mime: PDF, sizeBytes: s.buf.length })
  expect(JSON.stringify(mj)).not.toContain(`t/${w.tenant.id}`) // the key is never exposed

  const r = await download(w, s.id)
  expect(r.status).toBe(302)
  const loc = new URL(r.headers.get("location")!)
  expect(loc.pathname.endsWith(`/t/${w.tenant.id}/${s.id}`)).toBe(true)
  expect(loc.searchParams.get("X-Amz-Expires")).toBe("60")
  expect(loc.searchParams.get("response-content-disposition")).toBe("attachment; filename*=UTF-8''Quarterly%20r%C3%A9sum%C3%A9%20%28final%29.pdf")
  expect(loc.searchParams.get("response-content-type")).toBe(PDF)
  expect(r.headers.get("cache-control")).toBe("no-store")
  const got = await fetch(loc)
  expect(got.status).toBe(200)
  expect(got.headers.get("content-disposition")).toContain("attachment")
  expect(got.headers.get("content-type")).toBe(PDF)
  expect(Buffer.from(await got.arrayBuffer()).equals(s.buf)).toBe(true)
})

test("files:read can read metadata and download but cannot upload, complete or delete; files:none is refused everywhere (403)", async () => {
  const w = await world()
  const s = await scanned(w, "shared doc")
  expect((await req(w, "GET", `/v1/files/${s.id}`, w.cr)).status).toBe(200)
  expect((await download(w, s.id, w.cr)).status).toBe(302)
  expect((await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 5 }, w.cr)).status).toBe(403)
  expect((await complete(w, s.id, w.cr)).status).toBe(403)
  expect((await req(w, "DELETE", `/v1/files/${s.id}`, w.cr)).status).toBe(403)
  expect((await req(w, "GET", `/v1/files/${s.id}`, w.cs)).status).toBe(403)
  expect((await download(w, s.id, w.cs)).status).toBe(403)
  expect((await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 5 }, w.cs)).status).toBe(403)
  expect((await rowOf(w, s.id)).status).toBe("clean")
})

test("EICAR upload is marked infected, object deleted, owner notified, audited, download 410 file_infected", async () => {
  const w = await world()
  const s = await stage(w, EICAR, { name: "invoice.pdf" })
  await complete(w, s.id)
  await drain(w)
  const row = await rowOf(w, s.id)
  expect(row).toMatchObject({ status: "infected", signature: "Eicar-Signature" })
  expect(row.sha256).toBe(createHash("sha256").update(EICAR).digest("hex"))
  expect(await w.deps.storage.head(`t/${w.tenant.id}/${s.id}`)).toBeNull() // object is gone, metadata row stays
  const audit = await q(w.tenant.id, "select action, entity, entity_id, actor_id, after from audit_events where action like 'file.%'")
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ action: "file.infected", entity: "file", entity_id: s.id })
  expect((audit[0].after as Json).signature).toBe("Eicar-Signature")
  const notes = await q(w.tenant.id, "select user_id, kind, title from notifications")
  expect(notes).toHaveLength(1)
  expect(notes[0]).toMatchObject({ user_id: w.owner.userId, kind: "file" })
  expect((await q(w.tenant.id, "select payload from domain_events where type = 'file.scanned'"))[0].payload).toMatchObject({ fileId: s.id, status: "infected" })
  const r = await download(w, s.id)
  expect(r.status).toBe(410)
  expect(((await r.json()) as Json).code).toBe("file_infected")
  const meta = (await (await req(w, "GET", `/v1/files/${s.id}`)).json()) as Json
  expect(meta).toMatchObject({ status: "infected", signature: "Eicar-Signature" })
})

test("the scan job streams the object to the scanner in chunks (never one buffer) and the sha256 covers every byte", async () => {
  const sizes: number[] = []
  const scanner: MalwareScanner = {
    async scan(stream: Readable) {
      for await (const chunk of stream) sizes.push((chunk as Buffer).length)
      return { clean: true }
    },
  }
  const w = await world({ scanner })
  const big = Buffer.alloc(3 * 1024 * 1024, 9)
  const s = await scanned(w, big)
  expect(sizes.length).toBeGreaterThan(1)
  expect(Math.max(...sizes)).toBeLessThan(big.length)
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(big.length)
  expect((await rowOf(w, s.id)).sha256).toBe(createHash("sha256").update(big).digest("hex"))
})

test("client-supplied names with ../ or slashes never reach the object key", async () => {
  const w = await world()
  const names = ["../../etc/passwd", "a/b/c.pdf", "..\\..\\win.pdf", "%2e%2e/x.pdf", "t/other-tenant/evil.pdf"]
  for (const name of names) {
    const r = await intent(w, { name, mime: PDF, sizeBytes: 5 })
    expect(r.status, name).toBe(201)
    const j = (await r.json()) as { fileId: string; upload: Upload }
    expect(keyOfUrl(j.upload.url)).toBe(`u/${w.tenant.id}/${j.fileId}`)
    expect(keyOfUrl(j.upload.url)).not.toMatch(/\.\.|passwd|other-tenant|win\.pdf/)
    expect((await rowOf(w, j.fileId)).key).toBe(`t/${w.tenant.id}/${j.fileId}`)
  }
  // and the download name is encoded, so it cannot inject header parameters or newlines
  const s = await scanned(w, "x", { name: `a"; filename="evil.exe` })
  const loc = new URL((await download(w, s.id)).headers.get("location")!)
  expect(loc.searchParams.get("response-content-disposition")).toBe(`attachment; filename*=UTF-8''a%22%3B%20filename%3D%22evil.pdf`)
})

test("the files table forces key = t/<tenant>/<id> and a closed status set", async () => {
  const w = await world()
  const j = (await (await intent(w, { name: "a.pdf", mime: PDF, sizeBytes: 5 })).json()) as { fileId: string }
  await expect(q(w.tenant.id, "update files set key = 't/x/y' where id = $1", [j.fileId])).rejects.toMatchObject({ code: "23514" })
  await expect(q(w.tenant.id, "update files set status = 'weird' where id = $1", [j.fileId])).rejects.toMatchObject({ code: "23514" })
})

test("delete is a soft delete: audited, object removed by the delete job, then 404 on every route", async () => {
  const w = await world()
  const s = await scanned(w, "to delete")
  const key = `t/${w.tenant.id}/${s.id}`
  expect(await w.deps.storage.head(key)).not.toBeNull()
  const d = await req(w, "DELETE", `/v1/files/${s.id}`)
  expect(d.status).toBe(204)
  expect((await rowOf(w, s.id)).status).toBe("deleted")
  const audit = await q(w.tenant.id, "select action, actor_id, before, after from audit_events where action = 'file.deleted'")
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ actor_id: w.owner.userId })
  expect(w.queue.jobs.map((j) => j.name)).toContain("file.delete-object")
  await drain(w)
  expect(await w.deps.storage.head(key)).toBeNull()
  for (const [m, p] of [["GET", `/v1/files/${s.id}`], ["GET", `/v1/files/${s.id}/download`], ["POST", `/v1/files/${s.id}/complete`], ["DELETE", `/v1/files/${s.id}`]]) {
    const r = await req(w, m, p)
    expect(r.status, `${m} ${p}`).toBe(404)
    expect(((await r.json()) as Json).code).toBe("file_not_found")
  }
})

test("the delete-object job never removes a pending or clean object and rejects malformed job data", async () => {
  const w = await world()
  const s = await scanned(w, "keep me")
  const key = `t/${w.tenant.id}/${s.id}`
  await runJob("file.delete-object", { fileId: s.id, tenantId: w.tenant.id }, w.deps)
  expect(await w.deps.storage.head(key)).not.toBeNull() // clean: untouched
  const p = await stage(w, "pending one")
  await runJob("file.delete-object", { fileId: p.id, tenantId: w.tenant.id }, w.deps)
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, p.id))).not.toBeNull() // pending: untouched
  await expect(runJob("file.delete-object", { fileId: "not-a-uuid", tenantId: w.tenant.id }, w.deps)).rejects.toThrow()
})

test("re-PUTting to the old presigned URL after complete only writes the staging key; downloads keep serving the scanned bytes", async () => {
  const w = await world()
  const s = await scanned(w, "original content")
  const first = await download(w, s.id)
  expect(first.status).toBe(302)
  const oldUrl = first.headers.get("location")!
  const finalKey = fileKey(w.tenant.id, s.id)
  const etagBefore = (await w.deps.storage.head(finalKey))!.etag
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, s.id))).toBeNull() // staging cleaned by the delete job
  // within the 300 s window the client re-posts different bytes with the same (exact) policy
  expect((await put(s.upload, "tampered conten!")).status).toBe(200)
  expect((await put(s.upload, "X".repeat(16))).status).toBe(200)
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, s.id))).not.toBeNull() // landed in staging only
  expect((await w.deps.storage.head(finalKey))!.etag).toBe(etagBefore)
  expect((await rowOf(w, s.id)).status).toBe("clean")
  // a GET url issued BEFORE the re-POST still returns the original bytes, and so does a fresh one
  expect(await (await fetch(oldUrl)).text()).toBe("original content")
  const fresh = await download(w, s.id)
  expect(fresh.status).toBe(302)
  expect(await (await fetch(fresh.headers.get("location")!)).text()).toBe("original content")
  // the signed URL cannot be redirected to t/...
  expect(s.upload.url).not.toContain(`/t/`)
  expect((await put(s.upload, "x".repeat(16), { url: s.upload.url.replace(`/u/${w.tenant.id}/`, `/t/${w.tenant.id}/`) })).status).toBe(403)
  // the abandoned staging object is removed by a job queued at complete; delete removes both keys
  await runJob("file.delete-object", { fileId: s.id, tenantId: w.tenant.id, staging: true }, w.deps)
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, s.id))).toBeNull()
})

test("complete copies staging to the final key, deletes staging via a queued job, and a second complete after that is a no-op", async () => {
  const w = await world()
  const s = await stage(w, "hello pdf")
  expect(await w.deps.storage.head(fileKey(w.tenant.id, s.id))).toBeNull()
  expect((await complete(w, s.id)).status).toBe(200)
  expect(await w.deps.storage.head(fileKey(w.tenant.id, s.id))).not.toBeNull()
  expect(w.queue.jobs.map((j) => j.name).sort()).toEqual(["file.delete-object", "file.scan"])
  await drain(w)
  expect(await w.deps.storage.head(stagingKey(w.tenant.id, s.id))).toBeNull()
  expect((await rowOf(w, s.id)).status).toBe("clean")
  const again = await complete(w, s.id)
  expect(again.status).toBe(200)
  expect(((await again.json()) as Json).status).toBe("clean")
  expect(w.queue.jobs).toHaveLength(0)
})

test("download name: the extension is forced to the declared mime's canonical one", async () => {
  const w = await world()
  const cases: [string, string, string][] = [
    ["invoice.exe", PDF, "invoice.pdf"],
    ["x.html", "text/plain", "x.txt"],
    ["noext", "image/png", "noext.png"],
    ["photo.JPG", "image/jpeg", "photo.JPG"],
    ["photo.jpeg", "image/jpeg", "photo.jpeg"],
    ["v1.2", PDF, "v1.2.pdf"],
    ["a.exe.", PDF, "a.pdf"],
  ]
  for (const [name, mime, want] of cases) {
    const s = await scanned(w, "x", { name, mime })
    expect((await rowOf(w, s.id)).name, name).toBe(want)
    const loc = new URL((await download(w, s.id)).headers.get("location")!)
    expect(loc.searchParams.get("response-content-disposition"), name).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(want)}`)
  }
  const long = await intent(w, { name: "a".repeat(255), mime: PDF, sizeBytes: 5 })
  expect(long.status).toBe(201)
  expect((await rowOf(w, ((await long.json()) as { fileId: string }).fileId)).name).toHaveLength(255)
})

test("names that are not well-formed UTF-16 are 422 invalid_name", async () => {
  const w = await world()
  for (const name of ["\ud800", "ok\udc00.pdf"]) {
    const r = await call(w.app, "POST", "/v1/files/uploads", { cookie: w.co, tenant: w.tenant.slug, headers: { "content-type": "application/json" }, body: JSON.parse(JSON.stringify({ name, mime: PDF, sizeBytes: 5 })) })
    expect(r.status, name).toBe(422)
    expect(((await r.json()) as Json).code).toBe("invalid_name")
  }
})

test("scan and delete job ids carry a per-request nonce so retained completed jobs never dedupe a new request", async () => {
  const w = await world()
  const s = await stage(w, "hello")
  await complete(w, s.id)
  await complete(w, s.id)
  const scanIds = w.queue.jobs.filter((j) => j.name === "file.scan").map((j) => j.opts?.jobId)
  expect(new Set(scanIds).size).toBe(scanIds.length)
  expect(scanIds.every((id) => /^[A-Za-z0-9._-]+$/.test(id!))).toBe(true)
  await drain(w)
  await req(w, "DELETE", `/v1/files/${s.id}`)
  await complete(w, s.id).catch(() => undefined)
  const del = w.queue.jobs.filter((j) => j.name === "file.delete-object")
  expect(del).toHaveLength(1)
  expect(del[0].opts?.jobId).toMatch(/^file\.delete-object\.[0-9a-f-]{36}-[0-9a-f-]{36}$/)
})

test("a scanner failure fails closed: the file stays pending and the scan is retried with backoff, then given up after 5 attempts", async () => {
  const failing: MalwareScanner = { scan: async () => { throw new Error("clamd down") } }
  const w = await world({ scanner: failing })
  const s = await stage(w, "hello")
  await complete(w, s.id)
  for (let attempt = 1; attempt <= 5; attempt++) {
    const jobs = w.queue.jobs.splice(0).filter((j) => j.name === "file.scan")
    expect(jobs).toHaveLength(1)
    expect(jobs[0].data).toMatchObject({ fileId: s.id, tenantId: w.tenant.id, ...(attempt > 1 ? { attempt } : {}) })
    if (attempt > 1) expect(jobs[0].opts?.delayMs).toBeGreaterThan(0)
    expect(jobs[0].opts?.jobId).toMatch(/^[A-Za-z0-9._-]+$/)
    await runJob(jobs[0].name, jobs[0].data, w.deps)
    expect((await rowOf(w, s.id)).status).toBe("pending")
  }
  expect(w.queue.jobs).toHaveLength(0) // gave up (logged), still pending, never clean
  expect((await download(w, s.id)).status).toBe(409)
})

test("a deleted file is not resurrected by a scan result that lands after the delete", async () => {
  const w = await world()
  const s = await stage(w, EICAR)
  await complete(w, s.id)
  const scan = w.queue.jobs.splice(0)
  await req(w, "DELETE", `/v1/files/${s.id}`)
  for (const j of scan) await runJob(j.name, j.data, w.deps)
  expect((await rowOf(w, s.id)).status).toBe("deleted")
  expect(await q(w.tenant.id, "select 1 from audit_events where action = 'file.infected'")).toEqual([])
})

test("file id from another tenant gives 404 file_not_found on every files route", async () => {
  const w = await world()
  const other = await world()
  const s = await scanned(other, "theirs")
  for (const [m, p] of [["GET", `/v1/files/${s.id}`], ["GET", `/v1/files/${s.id}/download`], ["POST", `/v1/files/${s.id}/complete`], ["DELETE", `/v1/files/${s.id}`]]) {
    const r = await req(w, m, p)
    expect(r.status, `${m} ${p}`).toBe(404)
    expect(((await r.json()) as Json).code).toBe("file_not_found")
  }
  expect((await rowOf(other, s.id)).status).toBe("clean")
})

test("unauthenticated and wrong-tenant callers are refused", async () => {
  const w = await world()
  expect((await call(w.app, "POST", "/v1/files/uploads", { tenant: w.tenant.slug, body: { name: "a", mime: PDF, sizeBytes: 5 } })).status).toBe(401)
  const lone = await makeTenant(w.deps)
  expect((await call(w.app, "POST", "/v1/files/uploads", { cookie: w.co, tenant: lone.slug, body: { name: "a", mime: PDF, sizeBytes: 5 } })).status).toBe(404)
})

test("fakeScanner: auto mode flags EICAR, configured results win", async () => {
  const f = fakeScanner()
  expect(await f.scan(Readable.from([Buffer.from("fine")]))).toEqual({ clean: true })
  expect(await f.scan(Readable.from([Buffer.from(EICAR)]))).toEqual({ clean: false, signature: "Eicar-Signature" })
  f.result = { clean: false, signature: "Test-Sig" }
  expect(await f.scan(Readable.from([Buffer.from("fine")]))).toEqual({ clean: false, signature: "Test-Sig" })
})

test("two concurrent completes with the staging object replaced between them: the final key is written once, with the first upload's bytes", async () => {
  const real = (await world()).deps.storage
  let copiesToFinal = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let copied!: () => void
  const afterCopy = new Promise<void>((r) => (copied = r))
  const storage = {
    ...real,
    copy: async (from: string, to: string, o?: { ifMatchEtag?: string }) => {
      if (to.startsWith("t/")) copiesToFinal++
      await real.copy(from, to, o)
      if (copiesToFinal === 1) {
        copied()
        await gate // call A has copied E1 but has not committed yet
      }
    },
  }
  const w = await world({ storage })
  const s = await stage(w, "first upload!!!") // 15 bytes (E1)
  const a = complete(w, s.id)
  await afterCopy
  expect((await put(s.upload, "second upload!!")).status).toBe(200) // E2, same length, still-valid URL
  const b = complete(w, s.id) // blocks on the row lock held by A
  await new Promise((r) => setTimeout(r, 300))
  release()
  expect((await a).status).toBe(200)
  expect((await b).status).toBe(200)
  expect(copiesToFinal).toBe(1)
  await drain(w)
  expect((await rowOf(w, s.id)).status).toBe("clean")
  const dl = await download(w, s.id)
  expect(dl.status).toBe(302)
  expect(await (await fetch(dl.headers.get("location")!)).text()).toBe("first upload!!!")
})

test("complete when the staging object vanishes between HEAD and copy is 409 upload_missing, not 500", async () => {
  const real = (await world()).deps.storage
  const storage = { ...real, copy: async () => { await real.delete(stagingKey(tenantIdHolder.id, fileIdHolder.id)); return real.copy(stagingKey(tenantIdHolder.id, fileIdHolder.id), "t/x/y") } }
  const w = await world({ storage })
  tenantIdHolder.id = w.tenant.id
  const s = await stage(w, "hello pdf")
  fileIdHolder.id = s.id
  const c = await complete(w, s.id)
  expect(c.status).toBe(409)
  expect(((await c.json()) as Json).code).toBe("upload_missing")
})
const tenantIdHolder = { id: "" }
const fileIdHolder = { id: "" }

test("isScopedPurpose (rulings D9, F16): task_ and report_ purposes are scoped, an ordinary file and a DSR export are not", () => {
  for (const p of ["task_evidence", "task_attachment", "task_voice", "report_attachment", "report_export"]) expect(isScopedPurpose(p), p).toBe(true)
  for (const p of [null, undefined, "", "dsr_export", "tasks", "reports", "my_report_x"]) expect(isScopedPurpose(p), String(p)).toBe(false)
})
