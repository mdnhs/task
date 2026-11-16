import { createRoute, z } from "@hono/zod-openapi"
import { loadRole, requirePermission } from "../../core/middleware/permission"
import { requireModule } from "../../core/middleware/module"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { completeUpload, createUpload, deleteFile, downloadUrl, getFile } from "./service"

const Id = z.uuid()
const FileDto = z.object({
  id: z.string(), name: z.string(), mime: z.string(), sizeBytes: z.number(),
  status: z.enum(["pending", "clean", "infected", "deleted"]), signature: z.string().nullable(), sha256: z.string().nullable(),
  ownerUserId: z.string().nullable(), createdAt: z.string(), scannedAt: z.string().nullable(),
})
const IntentBody = z
  .object({
    name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters"),
    mime: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1),
  })
  .openapi({ example: { name: "shift-report.pdf", mime: "application/pdf", sizeBytes: 482113 } })
const Intent = z
  .object({ fileId: z.string(), upload: z.object({ method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()) }) })
  .openapi({ example: { fileId: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", upload: { method: "PUT", url: "https://<account_id>.r2.cloudflarestorage.com/<bucket>/u/<tenant>/<fileId>?X-Amz-...", headers: { "Content-Type": "application/pdf", "Content-Length": "482113" } } } })


const intentRoute = createRoute({
  method: "post", path: "/v1/files/uploads", middleware: [requireTenant, requireModule("M4"), requirePermission("files", "write")] as const,
  request: { body: { content: { "application/json": { schema: IntentBody } }, required: true } },
  responses: { 201: { description: "A presigned PUT (300 s) to a staging key; Content-Type and Content-Length are signed, send exactly `headers`. 422 mime_not_allowed, invalid_name or file_too_large; 503 storage_not_configured", content: { "application/json": { schema: Intent } } } },
})
const completeRoute = createRoute({
  method: "post", path: "/v1/files/{id}/complete", middleware: [requireTenant, requireModule("M4"), requirePermission("files", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: "Upload confirmed; status stays pending until the malware scan finishes. 422 upload_mismatch, 409 upload_missing. Idempotent", content: { "application/json": { schema: FileDto } } } },
})
const getRoute = createRoute({
  method: "get", path: "/v1/files/{id}", middleware: [requireTenant] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: "File metadata (never the storage key); needs files:read, except a DSR export which only its requester and settings:write may open. Another tenant's or a deleted id is 404 file_not_found", content: { "application/json": { schema: FileDto } } } },
})
const downloadRoute = createRoute({
  method: "get", path: "/v1/files/{id}/download", middleware: [requireTenant] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 302: { description: "Redirect to a 60 s presigned GET (attachment). 409 file_not_ready until clean, 410 file_infected" } },
})
const deleteRoute = createRoute({
  method: "delete", path: "/v1/files/{id}", middleware: [requireTenant, requireModule("M4"), requirePermission("files", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 204: { description: "Soft-deleted and audited; the stored object is removed by a background job" } },
})

export const fileRoutes = newRouter()
  .openapi(intentRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await createUpload(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("json")), 201)
  })
  .openapi(completeRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await completeUpload(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("param").id), 200)
  })
  .openapi(getRoute, async (c) => {
    const t = c.get("tenant")!
    const who = { userId: c.get("member")!.userId, role: await loadRole(c) } // files:read (or DSR-export access) is decided in the service
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => getFile(tx, t.id, c.req.valid("param").id, who)), 200)
  })
  .openapi(downloadRoute, async (c) => {
    const t = c.get("tenant")!
    const who = { userId: c.get("member")!.userId, role: await loadRole(c) }
    const url = await downloadUrl(c.get("deps"), t.id, c.req.valid("param").id, who)
    c.header("Cache-Control", "no-store")
    return c.redirect(url, 302)
  })
  .openapi(deleteRoute, async (c) => {
    const t = c.get("tenant")!
    await deleteFile(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("param").id)
    return c.body(null, 204)
  })
