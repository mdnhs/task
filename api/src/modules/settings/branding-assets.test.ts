import { createHash } from "node:crypto"
import { afterEach, beforeEach, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { call, putObject, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { resetSubscribers } from "../../core/events"
import { runJob } from "../../core/queue/queue"
import { unconfiguredStorage } from "../../core/storage/storage"
import { registerNotifications } from "../notifications"
import { registerFiles } from "../files"
import { ico, jpeg, png, SVG } from "./image-fixtures"

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
})
afterEach(resetSubscribers)

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Upload = { method: "PUT"; url: string; headers: Record<string, string> }
const q = <R = Record<string, unknown>>(tenant: string, sql: string, params: unknown[] = []) => ownerTenantQuery(tenant, sql, params) as Promise<R[]>
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

async function world(over: Parameters<typeof testApp>[0] = {}) {
  const t = testApp(over)
  const tenant = await makeTenant(t.deps, { slug: "acme", name: "Acme Ltd" })
  const other = await makeTenant(t.deps, { slug: "other" })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const auditor = await makeMember(t.deps, tenant.id, "auditor") // settings: read
  const staff = await makeMember(t.deps, tenant.id, "employee") // settings: none
  const otherOwner = await makeMember(t.deps, other.id, "owner")
  const co = (await signIn(t.app, owner.email, owner.password)).cookie
  const ca = (await signIn(t.app, auditor.email, auditor.password)).cookie
  const cs = (await signIn(t.app, staff.email, staff.password)).cookie
  const cx = (await signIn(t.app, otherOwner.email, otherOwner.password)).cookie
  const req = (method: string, path: string, cookie = co, body?: unknown, slug = tenant.slug, headers?: Record<string, string>) => call(t.app, method, path, { cookie, tenant: slug, body, headers })
  return { ...t, tenant, other, owner, co, ca, cs, cx, req }
}
type W = Awaited<ReturnType<typeof world>>

const put = async (up: Upload, buf: Buffer) => {
  const { "Content-Length": _l, ...headers } = up.headers
  return fetch(up.url, { method: "PUT", headers, body: buf })
}
const drain = async (w: W) => {
  for (let i = 0; i < 5 && w.queue.jobs.length > 0; i++) for (const j of w.queue.jobs.splice(0)) await runJob(j.name, j.data, w.deps)
}
const intent = (w: W, kind: string, body: unknown, cookie = w.co) => w.req("POST", `/v1/settings/branding/${kind}/uploads`, cookie, body)
const complete = (w: W, kind: string, id: string, cookie = w.co) => w.req("POST", `/v1/settings/branding/${kind}/uploads/${id}/complete`, cookie)
const activate = (w: W, kind: string, fileId: string, cookie = w.co) => w.req("PUT", `/v1/settings/branding/${kind}`, cookie, { fileId })
const serve = (w: W, kind: string, o: { cookie?: string; query?: string; headers?: Record<string, string>; slug?: string } = {}) =>
  w.req("GET", `/v1/branding/${kind}${o.query ?? ""}`, "cookie" in o ? o.cookie : w.cs, undefined, o.slug ?? w.tenant.slug, o.headers)

/** intent + PUT + complete (+ scan); returns the file id. */
async function upload(w: W, kind: "logo" | "favicon", buf: Buffer, mime: string, name = kind === "logo" ? "logo.png" : "favicon.png") {
  const r = await intent(w, kind, { name, mime, sizeBytes: buf.length })
  expect(r.status).toBe(201)
  const j = (await r.json()) as { fileId: string; upload: Upload }
  expect((await put(j.upload, buf)).status).toBe(200)
  const c = await complete(w, kind, j.fileId)
  expect(c.status).toBe(200)
  await drain(w)
  return j.fileId
}
const live = async (w: W, kind: "logo" | "favicon", buf: Buffer, mime: string) => {
  const id = await upload(w, kind, buf, mime)
  const a = await activate(w, kind, id)
  expect(a.status).toBe(200)
  return { id, branding: (await a.json()) as Json }
}
const audits = (tenant: string, action: string) => q(tenant, "select actor_id, before, after from audit_events where action = $1 order by seq", [action])
const status = async (w: W, id: string) => (await q<{ status: string; purpose: string }>(w.tenant.id, "select status, purpose from files where id = $1", [id]))[0]

test("intent: only settings:write, only the allow-listed raster types and sizes (SVG never), 201 with a presigned PUT to the staging key", async () => {
  const w = await world()
  const ok = await intent(w, "logo", { name: "logo.png", mime: "image/png", sizeBytes: 500 })
  expect(ok.status).toBe(201)
  const j = (await ok.json()) as { fileId: string; upload: Upload }
  expect(j.upload.url).toContain(`u/${w.tenant.id}/${j.fileId}`)
  expect((await status(w, j.fileId))?.purpose).toBe("branding_logo")
  const code = async (kind: string, body: unknown, cookie = w.co) => {
    const r = await intent(w, kind, body, cookie)
    return [r.status, ((await r.json()) as Json).code]
  }
  expect(await code("logo", { name: "logo.svg", mime: "image/svg+xml", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("favicon", { name: "f.svg", mime: "image/svg+xml", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("logo", { name: "a.gif", mime: "image/gif", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("logo", { name: "a.pdf", mime: "application/pdf", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("logo", { name: "a.ico", mime: "image/x-icon", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"]) // an ICO is a favicon type only
  expect(await code("favicon", { name: "f.jpg", mime: "image/jpeg", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("favicon", { name: "f.webp", mime: "image/webp", sizeBytes: 500 })).toEqual([422, "mime_not_allowed"])
  expect(await code("logo", { name: "logo.png", mime: "image/png", sizeBytes: 1024 * 1024 + 1 })).toEqual([422, "file_too_large"])
  expect(await code("favicon", { name: "f.png", mime: "image/png", sizeBytes: 256 * 1024 + 1 })).toEqual([422, "file_too_large"])
  expect((await code("logo", { name: "logo.png", mime: "image/png", sizeBytes: 1024 * 1024 }))[0]).toBe(201)
  expect((await code("favicon", { name: "f.ico", mime: "image/x-icon", sizeBytes: 256 * 1024 }))[0]).toBe(201)
  expect((await code("favicon", { name: "f.ico", mime: "image/vnd.microsoft.icon", sizeBytes: 100 }))[0]).toBe(201)
  expect((await code("banner", { name: "a.png", mime: "image/png", sizeBytes: 5 }))[0]).toBe(400) // only logo and favicon exist
  expect((await code("logo", { name: "logo.png", mime: "image/png", sizeBytes: 5 }, w.ca))[0]).toBe(403) // settings:read is not enough
  expect((await code("logo", { name: "logo.png", mime: "image/png", sizeBytes: 5 }, w.cs))[0]).toBe(403)
})

test("happy path: upload, scan, activate; the asset is served to any member with nosniff, inline disposition, a content-addressed ETag and revalidating or immutable caching", async () => {
  const w = await world()
  const buf = png(120, 40)
  const id = await upload(w, "logo", buf, "image/png")
  expect((await status(w, id))?.status).toBe("clean")
  const poll = await w.req("GET", `/v1/settings/branding/logo/uploads/${id}`)
  expect(await poll.json()).toMatchObject({ fileId: id, status: "clean" })
  const a = await activate(w, "logo", id)
  expect(a.status).toBe(200)
  const version = createHash("sha256").update(buf).digest("hex").slice(0, 16)
  const b = (await a.json()) as Json
  expect(b.logo).toEqual({ version, mime: "image/png", width: 120, height: 40, sizeBytes: buf.length })
  expect(b.favicon).toBeNull()
  expect(JSON.stringify(b)).not.toContain(id) // the file id is never exposed: the asset is addressed by kind
  expect(await (await w.req("GET", "/v1/settings/branding", w.ca)).json()).toMatchObject({ logo: b.logo, favicon: null, primaryColor: null, storageReady: true })

  const r = await serve(w, "logo") // a member with no settings access
  expect(r.status).toBe(200)
  expect(Buffer.from(await r.arrayBuffer()).equals(buf)).toBe(true)
  expect(r.headers.get("content-type")).toBe("image/png")
  expect(r.headers.get("x-content-type-options")).toBe("nosniff")
  expect(r.headers.get("content-disposition")).toMatch(/^inline; filename="logo\.png"/)
  expect(r.headers.get("content-security-policy")).toContain("default-src 'none'")
  expect(r.headers.get("etag")).toBe(`"${version}"`)
  expect(r.headers.get("cache-control")).toBe("private, no-cache")
  const pinned = await serve(w, "logo", { query: `?v=${version}` })
  expect(pinned.headers.get("cache-control")).toBe("private, max-age=31536000, immutable")
  expect((await serve(w, "logo", { query: "?v=stale" })).headers.get("cache-control")).toBe("private, no-cache") // a stale version never gets the long lifetime
  const again = await serve(w, "logo", { headers: { "if-none-match": `"${version}"` } })
  expect(again.status).toBe(304)
  expect((await serve(w, "logo", { headers: { "if-none-match": '"other"' } })).status).toBe(200)

  const audit = await audits(w.tenant.id, "tenant.branding_logo_updated")
  expect(audit).toHaveLength(1)
  expect(audit[0].before).toEqual({ logo: null })
  expect(audit[0].after).toEqual({ logo: { version, mime: "image/png", width: 120, height: 40, sizeBytes: buf.length } })
  expect(JSON.stringify(audit[0])).not.toMatch(/PNG|IHDR|name/) // no file contents, no file name
})

test("favicon: a square PNG and an ICO; an ICO is served as image/x-icon", async () => {
  const w = await world()
  const { branding } = await live(w, "favicon", png(64, 64), "image/png")
  expect(branding.favicon).toMatchObject({ mime: "image/png", width: 64, height: 64 })
  expect((await serve(w, "favicon")).headers.get("content-type")).toBe("image/png")
  const i = ico([16, 32])
  const { branding: b2 } = await live(w, "favicon", i, "image/vnd.microsoft.icon")
  expect(b2.favicon).toMatchObject({ mime: "image/x-icon", width: 32, height: 32 })
  const r = await serve(w, "favicon")
  expect(r.headers.get("content-type")).toBe("image/x-icon")
  expect(r.headers.get("content-disposition")).toMatch(/^inline; filename="favicon\.ico"/)
})

test("complete checks the BYTES, never the client mime: SVG, wrong type, not square, polyglots and corrupt files are refused and the staging object is gone", async () => {
  const w = await world()
  const bad = async (kind: "logo" | "favicon", buf: Buffer, mime: string, expected: string) => {
    const r = await intent(w, kind, { name: "x.png", mime, sizeBytes: buf.length })
    const j = (await r.json()) as { fileId: string; upload: Upload }
    expect((await put(j.upload, buf)).status).toBe(200)
    const c = await complete(w, kind, j.fileId)
    expect([c.status, ((await c.json()) as Json).code]).toEqual([422, expected])
    // nothing was copied to the final key and the row can never become the logo
    expect((await status(w, j.fileId))?.status).toBe("pending")
    expect((await activate(w, kind, j.fileId)).status).toBe(409)
    await drain(w)
    expect((await status(w, j.fileId))?.status).toBe("pending")
    expect(w.queue.jobs.some((x) => x.name === "file.scan")).toBe(false)
  }
  await bad("logo", SVG, "image/png", "image_suspicious")
  await bad("logo", png(64, 64), "image/jpeg", "image_type_mismatch")
  await bad("logo", jpeg(64, 64), "image/png", "image_type_mismatch")
  await bad("logo", png(64, 64, { trailing: Buffer.from("PK\x03\x04zip") }), "image/png", "image_suspicious")
  await bad("logo", png(64, 64, { extraChunk: Buffer.from("<script>alert(1)</script>") }), "image/png", "image_suspicious")
  await bad("logo", png(10, 10), "image/png", "image_dimensions")
  await bad("favicon", png(64, 40), "image/png", "image_not_square")
  await bad("favicon", png(16, 16), "image/png", "image_dimensions")
  await bad("favicon", ico([32], { trailing: Buffer.from("MZ....") }), "image/x-icon", "image_suspicious")
  await bad("favicon", Buffer.from("this is not an icon at all"), "image/x-icon", "image_type_mismatch")
  const staging = await q<{ c: string }>(w.tenant.id, "select count(*)::text c from files where status = 'pending'")
  expect(Number(staging[0].c)).toBeGreaterThan(0) // rows exist but none became live
  expect(await (await w.req("GET", "/v1/settings/branding")).json()).toMatchObject({ logo: null, favicon: null })
})

test("an infected file is blocked: it never becomes the logo, the poll says infected", async () => {
  const w = await world()
  const buf = png(64, 64, { extraChunk: Buffer.from(EICAR) })
  const id = await upload(w, "logo", buf, "image/png")
  expect((await status(w, id))?.status).toBe("infected")
  expect(await (await w.req("GET", `/v1/settings/branding/logo/uploads/${id}`)).json()).toMatchObject({ status: "infected" })
  const a = await activate(w, "logo", id)
  expect([a.status, ((await a.json()) as Json).code]).toEqual([410, "file_infected"])
  expect((await serve(w, "logo")).status).toBe(404)
})

test("activate: not before the scan is clean; only a file made through the SAME kind's upload; nothing from /v1/files, another tenant or another kind", async () => {
  const w = await world()
  const buf = png(64, 64)
  const r = await intent(w, "logo", { name: "logo.png", mime: "image/png", sizeBytes: buf.length })
  const j = (await r.json()) as { fileId: string; upload: Upload }
  await put(j.upload, buf)
  await complete(w, "logo", j.fileId)
  const early = await activate(w, "logo", j.fileId) // scan job not run yet
  expect([early.status, ((await early.json()) as Json).code]).toEqual([409, "file_not_ready"])
  await drain(w)
  const wrongKind = await activate(w, "favicon", j.fileId)
  expect([wrongKind.status, ((await wrongKind.json()) as Json).code]).toEqual([404, "file_not_found"])
  // an ordinary /v1/files upload (a clean png of this tenant) is not a branding asset
  const gi = await w.req("POST", "/v1/files/uploads", w.co, { name: "p.png", mime: "image/png", sizeBytes: buf.length })
  const g = (await gi.json()) as { fileId: string; upload: Upload }
  await put(g.upload, buf)
  await w.req("POST", `/v1/files/${g.fileId}/complete`)
  await drain(w)
  expect((await activate(w, "logo", g.fileId)).status).toBe(404)
  expect((await activate(w, "logo", crypto.randomUUID())).status).toBe(404)
  // another tenant's branding file
  const xr = await call(w.app, "POST", "/v1/settings/branding/logo/uploads", { cookie: w.cx, tenant: "other", body: { name: "l.png", mime: "image/png", sizeBytes: buf.length } })
  const x = (await xr.json()) as { fileId: string; upload: Upload }
  await put(x.upload, buf)
  expect((await activate(w, "logo", x.fileId)).status).toBe(404)
  expect((await activate(w, "logo", j.fileId, w.ca)).status).toBe(403)
  expect((await activate(w, "logo", "not-a-uuid")).status).toBe(400)
  expect((await activate(w, "logo", j.fileId)).status).toBe(200)
})

test("branding files are invisible to /v1/files (scoped purpose): metadata and download answer 404", async () => {
  const w = await world()
  const { id } = await live(w, "logo", png(64, 64), "image/png")
  expect((await w.req("GET", `/v1/files/${id}`)).status).toBe(404)
  expect((await w.req("GET", `/v1/files/${id}/download`)).status).toBe(404)
  expect((await w.req("DELETE", `/v1/files/${id}`)).status).toBe(404)
})

test("replace: the new asset is served at once, the old file is deleted and its object removed by the existing lifecycle; the audit shows both versions", async () => {
  const w = await world()
  const first = png(64, 64)
  const { id: oldId } = await live(w, "logo", first, "image/png")
  const second = png(96, 48)
  const { id: newId, branding } = await live(w, "logo", second, "image/png")
  expect(branding.logo).toMatchObject({ width: 96, height: 48, mime: "image/png" })
  expect((await status(w, oldId))?.status).toBe("deleted")
  expect((await status(w, newId))?.status).toBe("clean")
  await drain(w) // file.delete-object for the old one ran inside live()'s drain? run again to be sure
  const [row] = await q<{ object_removed_at: string | null }>(w.tenant.id, "select object_removed_at from files where id = $1", [oldId])
  expect(row.object_removed_at).not.toBeNull()
  const r = await serve(w, "logo")
  expect(Buffer.from(await r.arrayBuffer()).equals(second)).toBe(true)
  const a = await audits(w.tenant.id, "tenant.branding_logo_updated")
  expect(a).toHaveLength(2)
  expect(a[1].before).toMatchObject({ logo: { width: 64, height: 64 } })
  expect(a[1].after).toMatchObject({ logo: { width: 96, height: 48 } })
})

test("remove: clears the asset, deletes the file and its object, audits, and is idempotent", async () => {
  const w = await world()
  const { id } = await live(w, "favicon", png(64, 64), "image/png")
  expect((await w.req("DELETE", "/v1/settings/branding/favicon", w.ca)).status).toBe(403)
  expect((await w.req("DELETE", "/v1/settings/branding/favicon", w.cs)).status).toBe(403)
  const d = await w.req("DELETE", "/v1/settings/branding/favicon")
  expect(d.status).toBe(200)
  expect(await d.json()).toMatchObject({ favicon: null })
  expect((await status(w, id))?.status).toBe("deleted")
  await drain(w)
  const [row] = await q<{ object_removed_at: string | null }>(w.tenant.id, "select object_removed_at from files where id = $1", [id])
  expect(row.object_removed_at).not.toBeNull()
  expect((await serve(w, "favicon")).status).toBe(404)
  const a = await audits(w.tenant.id, "tenant.branding_favicon_removed")
  expect(a).toHaveLength(1)
  expect(a[0].before).toMatchObject({ favicon: { width: 64 } })
  expect(a[0].after).toEqual({ favicon: null })
  expect((await w.req("DELETE", "/v1/settings/branding/favicon")).status).toBe(200) // nothing to remove: still 200, no second audit
  expect(await audits(w.tenant.id, "tenant.branding_favicon_removed")).toHaveLength(1)
})

test("serving needs a signed-in member of THIS tenant; each tenant only ever sees its own asset", async () => {
  const w = await world()
  await live(w, "logo", png(64, 64), "image/png")
  expect((await call(w.app, "GET", "/v1/branding/logo", { tenant: w.tenant.slug })).status).toBe(401)
  expect((await serve(w, "logo", { cookie: w.cx })).status).toBe(404) // a member of another tenant naming this one: the same 404 as no such tenant
  expect((await serve(w, "logo", { cookie: w.cx, slug: "other" })).status).toBe(404) // their own tenant has none
  expect((await serve(w, "banner")).status).toBe(400)
  expect((await serve(w, "logo")).status).toBe(200)
})

test("saving the colour keeps both assets; the colour PUT no longer takes a file", async () => {
  const w = await world()
  await live(w, "logo", png(64, 64), "image/png")
  await live(w, "favicon", png(64, 64), "image/png")
  const r = await w.req("PUT", "/v1/settings/branding", w.co, { primaryColor: "#112233", logoFileId: crypto.randomUUID() })
  expect(r.status).toBe(200)
  const b = (await r.json()) as Json
  expect(b).toMatchObject({ primaryColor: "#112233" })
  expect(b.logo).not.toBeNull()
  expect(b.favicon).not.toBeNull()
  expect((await serve(w, "logo")).status).toBe(200)
})

test("an object swapped in storage after the scan is never served (the stored ETag is checked on every read)", async () => {
  const w = await world()
  const { id } = await live(w, "logo", png(64, 64), "image/png")
  expect((await serve(w, "logo")).status).toBe(200)
  await putObject(`t/${w.tenant.id}/${id}`, SVG, "image/png") // a replaced object, as an attacker with bucket access might leave it
  const r = await serve(w, "logo")
  expect([r.status, ((await r.json()) as Json).code]).toEqual([404, "branding_asset_not_found"])
})

test("storageReady says whether uploads can work (false when no storage is configured)", async () => {
  const w = await world({ storage: unconfiguredStorage() })
  expect(await (await w.req("GET", "/v1/settings/branding")).json()).toMatchObject({ storageReady: false })
})
