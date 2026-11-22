import { Readable } from "node:stream"
import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { NotFound } from "../../core/errors"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { completeUpload, createUpload } from "../files"
import { activateAsset, brandingPolicy, prepareIntent, removeAsset, servedAsset, uploadStatus } from "./branding-assets"
import { BRANDING_KINDS, type BrandingKind } from "./image-inspect"
import { getBranding } from "./service"

const Kind = z.enum(BRANDING_KINDS).openapi({ description: "logo (PNG, JPEG or WebP, up to 1 MB, 32-4096 px per side) or favicon (square PNG 32-512 px, or an ICO, up to 256 KB)" })
const Asset = z.object({ version: z.string(), mime: z.string(), width: z.number().int(), height: z.number().int(), sizeBytes: z.number().int() })
const AssetExample = { version: "9f86d081884c7d65", mime: "image/png", width: 240, height: 64, sizeBytes: 8123 }
const Branding = z.object({ primaryColor: z.string().nullable(), logo: Asset.nullable(), favicon: Asset.nullable(), storageReady: z.boolean().openapi({ description: "false when no object storage is configured (the platform Storage settings): uploads cannot work yet" }) })
const BrandingExample = { primaryColor: "#0A1B2C", logo: AssetExample, favicon: null, storageReady: true }
const IntentBody = z
  .object({ name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters"), mime: z.string().min(1).max(255), sizeBytes: z.number().int().min(1) })
  .openapi({ example: { name: "logo.png", mime: "image/png", sizeBytes: 8123 } })
const Intent = z
  .object({ fileId: z.string(), upload: z.object({ method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()) }) })
  .openapi({ example: { fileId: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", upload: { method: "PUT", url: "https://<account_id>.r2.cloudflarestorage.com/<bucket>/u/<tenant>/<fileId>?X-Amz-...", headers: { "Content-Type": "image/png", "Content-Length": "8123" } } } })
const Params = z.object({ kind: Kind })
const FileParams = z.object({ kind: Kind, fileId: z.uuid() })
const Status = z.object({ fileId: z.string(), status: z.enum(["pending", "clean", "infected"]) }).openapi({ example: { fileId: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", status: "clean" } })
const ActivateBody = z.object({ fileId: z.uuid() }).openapi({ example: { fileId: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90" } })

const intentRoute = createRoute({
  method: "post", path: "/v1/settings/branding/{kind}/uploads", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: Params, body: { content: { "application/json": { schema: IntentBody } }, required: true } },
  responses: { 201: { description: "A presigned PUT (300 s) to a staging key; send exactly `headers`. 422 mime_not_allowed (SVG and every non-listed type), invalid_name or file_too_large (logo 1 MB, favicon 256 KB); 429 too_many_uploads (5 unfinished uploads of that kind); 503 storage_not_configured", content: { "application/json": { schema: Intent } } } },
})
const completeRoute = createRoute({
  method: "post", path: "/v1/settings/branding/{kind}/uploads/{fileId}/complete", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: FileParams },
  responses: { 200: { description: "Upload confirmed and its bytes checked (magic bytes, structure, size, squareness; markup and trailing data refused); the malware scan runs next. 422 image_type_mismatch | image_corrupt | image_not_square | image_dimensions | image_suspicious | upload_mismatch, 409 upload_missing. Idempotent", content: { "application/json": { schema: Status } } } },
})
const statusRoute = createRoute({
  method: "get", path: "/v1/settings/branding/{kind}/uploads/{fileId}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: FileParams },
  responses: { 200: { description: "Scan state of an upload: pending until the malware scan decided, then clean or infected. 404 file_not_found", content: { "application/json": { schema: Status } } } },
})
const activateRoute = createRoute({
  method: "put", path: "/v1/settings/branding/{kind}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: Params, body: { content: { "application/json": { schema: ActivateBody } }, required: true } },
  responses: { 200: { description: "The clean upload becomes the live asset; the previous one is deleted. Audited without file contents. 404 file_not_found (another tenant, another kind, an ordinary file), 409 file_not_ready, 410 file_infected, 422 image_*", content: { "application/json": { schema: Branding.openapi({ example: BrandingExample }) } } } },
})
const removeRoute = createRoute({
  method: "delete", path: "/v1/settings/branding/{kind}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: Params },
  responses: { 200: { description: "The asset is removed and its file deleted. Idempotent", content: { "application/json": { schema: Branding.openapi({ example: { ...BrandingExample, logo: null } }) } } } },
})
const Binary = z.string().openapi({ format: "binary" })
const serveRoute = createRoute({
  method: "get", path: "/v1/branding/{kind}", middleware: [requireTenant] as const,
  request: { params: Params, query: z.object({ v: z.string().max(64).optional().openapi({ description: "The asset version from GET /v1/me/tenant. A request that names the CURRENT version may be cached for a year; any other value is revalidated" }) }) },
  responses: {
    200: { description: "The logo or favicon bytes, for any member of the tenant. Content-Type is the stored (verified) type, nosniff, inline, ETag = version", content: { "image/png": { schema: Binary }, "image/jpeg": { schema: Binary }, "image/webp": { schema: Binary }, "image/x-icon": { schema: Binary } } },
    304: { description: "If-None-Match matches the current version" },
    404: { description: "None is set, or its file is not clean" },
  },
})

const asKind = (k: string) => k as BrandingKind

export async function brandingWithStorage(deps: Deps, tenantId: string) {
  const [b, storageReady] = await Promise.all([withTenant(deps.db, tenantId, (tx) => getBranding(tx, tenantId)), deps.storage.configured ? deps.storage.configured() : Promise.resolve(true)])
  return { ...b, storageReady }
}

export const brandingRoutes = newRouter()
  .openapi(intentRoute, async (c) => {
    const t = c.get("tenant")!
    const kind = asKind(c.req.valid("param").kind)
    const actor = { userId: c.get("member")!.userId }
    await prepareIntent(c.get("deps"), t.id, actor.userId, kind)
    return c.json(await createUpload(c.get("deps"), t.id, actor, c.req.valid("json"), brandingPolicy(kind, t.id, actor.userId)), 201)
  })
  .openapi(completeRoute, async (c) => {
    const t = c.get("tenant")!
    const { kind, fileId } = c.req.valid("param")
    const actor = { userId: c.get("member")!.userId }
    const file = await completeUpload(c.get("deps"), t.id, actor, fileId, brandingPolicy(asKind(kind), t.id, actor.userId))
    return c.json({ fileId: file.id, status: file.status === "clean" ? ("clean" as const) : file.status === "infected" ? ("infected" as const) : ("pending" as const) }, 200)
  })
  .openapi(statusRoute, async (c) => {
    const t = c.get("tenant")!
    const { kind, fileId } = c.req.valid("param")
    return c.json(await uploadStatus(c.get("deps"), t.id, c.get("member")!.userId, asKind(kind), fileId), 200)
  })
  .openapi(activateRoute, async (c) => {
    const t = c.get("tenant")!
    await activateAsset(c.get("deps"), t.id, c.get("member")!.userId, asKind(c.req.valid("param").kind), c.req.valid("json").fileId)
    return c.json(await brandingWithStorage(c.get("deps"), t.id), 200)
  })
  .openapi(removeRoute, async (c) => {
    const t = c.get("tenant")!
    await removeAsset(c.get("deps"), t.id, c.get("member")!.userId, asKind(c.req.valid("param").kind))
    return c.json(await brandingWithStorage(c.get("deps"), t.id), 200)
  })
  .openapi(serveRoute, async (c) => {
    const t = c.get("tenant")!
    const deps = c.get("deps")
    const kind = asKind(c.req.valid("param").kind)
    const a = await servedAsset(deps, t.id, kind)
    if (!a) throw NotFound("branding_asset_not_found")
    const etag = `"${a.version}"`
    const pinned = c.req.valid("query").v === a.version
    const headers: Record<string, string> = {
      ETag: etag,
      "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      Vary: "Cookie",
    }
    const inm = c.req.header("if-none-match")
    if (inm && inm.split(",").some((x) => x.trim().replace(/^W\//, "") === etag)) return c.body(null, 304, headers)
    const head = await deps.storage.head(a.key)
    if (!head || head.etag !== a.etag) throw NotFound("branding_asset_not_found") // changed after the scan: never served
    const body = Readable.toWeb(await deps.storage.getStream(a.key)) as unknown as ReadableStream
    return c.body(body, 200, { ...headers, "Content-Type": a.mime, "Content-Length": String(head.size), "Content-Disposition": `inline; filename="${a.name}"` })
  })
