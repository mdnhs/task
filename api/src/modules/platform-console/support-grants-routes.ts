import { createRoute, z } from "@hono/zod-openapi"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { SUPPORT_STAFF_ROLES } from "../../core/middleware/support"
import { requireTenant } from "../../core/middleware/tenant"
import { PLATFORM_ROLES } from "../platform-staff"
import { newRouter } from "../../core/router"
import { createSupportGrant, listSupportGrants, listSupportGrantsForStaff, type StaffGrantItem, revokeSupportGrantAsStaff, revokeSupportGrantAsTenant, type GrantView } from "./support-grants"

const TID = "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10"
const GID = "7c2e9a41-3b5d-4e8f-9a10-6d4c2b1e0f93"
const SID = "usr_8Kq2mZ4tW1"
const NOW = "2026-11-17T09:00:00.000Z"
const LATER = "2026-11-17T11:00:00.000Z"

const Grant = z.object({
  id: z.string(), tenantId: z.string(), staffUserId: z.string(), reason: z.string(), grantedBy: z.string(),
  startsAt: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(), status: z.enum(["active", "expired", "revoked"]),
})
const GrantExample = { id: GID, tenantId: TID, staffUserId: SID, reason: "Ticket 4411: report totals look wrong", grantedBy: SID, startsAt: NOW, expiresAt: LATER, revokedAt: null, status: "active" as const }
const GrantDto = Grant.openapi({ example: GrantExample })
const TenantGrant = Grant.extend({ staffName: z.string().nullable() })
const TenantGrantList = z.object({ items: z.array(TenantGrant) }).openapi({ example: { items: [{ ...GrantExample, staffName: "Aoife Support" }] } })

// reason / hours are checked by the service (422), not by zod (which would answer 400). Unknown keys (e.g. a staffUserId) are dropped:
// a grant is always for the caller.
const CreateBody = z.object({
  reason: z.unknown().optional().openapi({ description: "Required: 1..500 characters (422 invalid_reason otherwise)", example: "Ticket 4411: report totals look wrong" }),
  hours: z.unknown().optional().openapi({ description: "Integer 1..24 (422 invalid_hours otherwise)", example: 2 }),
}).openapi({ example: { reason: "Ticket 4411: report totals look wrong", hours: 2 } })
const StaffGrant = z.object({
  id: z.string(), tenantId: z.string(), tenantName: z.string(), grantedBy: z.string(), staffName: z.string().nullable(),
  scope: z.literal("read_only"), reason: z.string(), status: z.enum(["active", "expired", "revoked"]),
  createdAt: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(),
})
const StaffGrantList = z.object({ items: z.array(StaffGrant), nextCursor: z.string().nullable() }).openapi({
  example: { items: [{ id: GID, tenantId: TID, tenantName: "Coppers Cafe", grantedBy: SID, staffName: "Aoife Support", scope: "read_only", reason: GrantExample.reason, status: "active", createdAt: NOW, expiresAt: LATER, revokedAt: null }], nextCursor: null },
})
const StaffListQuery = z.object({
  tenantId: z.string().max(64).optional().openapi({ example: TID }),
  status: z.enum(["active", "expired", "revoked"]).optional().openapi({ example: "active" }),
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50 }),
  cursor: z.string().max(200).optional().openapi({ example: "MjAyNi0xMS0xN1QwOTowMDowMC4wMDBafDdjMmU5YTQxLTNiNWQtNGU4Zi05YTEwLTZkNGMyYjFlMGY5Mw" }),
})
const TenantParam = z.object({ tenantId: z.string().min(1).max(64).openapi({ param: { name: "tenantId", in: "path" }, example: TID }) })
const GrantParam = z.object({ id: z.string().min(1).max(64).openapi({ param: { name: "id", in: "path" }, example: GID }) })

const roleGate = (...keys: string[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const member = c.get("member")
  if (!member || !keys.includes(member.roleKey)) throw Forbidden("forbidden")
  await next()
}

const createGrantRoute = createRoute({
  method: "post", path: "/v1/platform/tenants/{tenantId}/support-grants", middleware: [requirePlatformStaff(...SUPPORT_STAFF_ROLES)] as const,
  request: { params: TenantParam, body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: { 201: { description: "Read-only support access to the tenant FOR THE CALLER, from now for `hours`. Tenant owners are notified at once. Audited in both chains. 404 tenant_not_found (also suspended), 409 grant_exists, 422 invalid_reason | invalid_hours", content: { "application/json": { schema: GrantDto } } } },
})
const listStaffRoute = createRoute({
  method: "get", path: "/v1/platform/support-grants", middleware: [requirePlatformStaff(...PLATFORM_ROLES)] as const,
  request: { query: StaffListQuery },
  responses: { 200: { description: "Support grants across tenants (or one tenant), newest first by start time then id, keyset `cursor` (400 invalid_cursor), at most `limit` (default 50, max 100). Every platform role may read; scope is always read_only; no secret exists on a grant. A read: no audit row, an info log line. 404 tenant_not_found for an unknown `tenantId`", content: { "application/json": { schema: StaffGrantList } } } },
})
const revokeStaffRoute = createRoute({
  method: "delete", path: "/v1/platform/support-grants/{id}", middleware: [requirePlatformStaff(...SUPPORT_STAFF_ROLES)] as const,
  request: { params: GrantParam },
  responses: { 200: { description: "Revoked (platform owner: any grant; otherwise only the grantee's own: 403 platform_forbidden). 404 grant_not_found, 409 grant_inactive", content: { "application/json": { schema: GrantDto } } } },
})
const listTenantRoute = createRoute({
  method: "get", path: "/v1/settings/support-grants", middleware: [requireTenant, roleGate("owner", "admin")] as const,
  responses: { 200: { description: "The tenant's support grants (newest first, at most 200) with the staff display name (owner or admin)", content: { "application/json": { schema: TenantGrantList } } } },
})
const revokeTenantRoute = createRoute({
  method: "delete", path: "/v1/settings/support-grants/{id}", middleware: [requireTenant, roleGate("owner")] as const,
  request: { params: GrantParam },
  responses: { 200: { description: "Revoked by a tenant owner; support loses access on its next request. Audited in both chains. 404 grant_not_found, 409 grant_inactive", content: { "application/json": { schema: GrantDto } } } },
})

const staffItem = (g: StaffGrantItem) => ({
  id: g.id, tenantId: g.tenantId, tenantName: g.tenantName, grantedBy: g.grantedBy, staffName: g.staffName, scope: "read_only" as const, reason: g.reason, status: g.status,
  createdAt: g.startsAt.toISOString(), expiresAt: g.expiresAt.toISOString(), revokedAt: g.revokedAt?.toISOString() ?? null,
})
const iso = (g: GrantView) => ({ ...g, startsAt: g.startsAt.toISOString(), expiresAt: g.expiresAt.toISOString(), revokedAt: g.revokedAt?.toISOString() ?? null })

export const supportGrantRoutes = newRouter()
  .openapi(createGrantRoute, async (c) => c.json(iso(await createSupportGrant(c.get("deps"), c.req.valid("param").tenantId, c.get("staff")!, c.req.valid("json"))), 201))
  .openapi(listStaffRoute, async (c) => {
    const r = await listSupportGrantsForStaff(c.get("deps"), c.get("staff")!, c.req.valid("query"))
    return c.json({ items: r.items.map(staffItem), nextCursor: r.nextCursor }, 200)
  })
  .openapi(revokeStaffRoute, async (c) => c.json(iso(await revokeSupportGrantAsStaff(c.get("deps"), c.req.valid("param").id, c.get("staff")!)), 200))
  .openapi(listTenantRoute, async (c) => c.json({ items: (await listSupportGrants(c.get("deps"), c.get("tenant")!.id)).map((g) => ({ ...iso(g), staffName: g.staffName })) }, 200))
  .openapi(revokeTenantRoute, async (c) => c.json(iso(await revokeSupportGrantAsTenant(c.get("deps"), c.get("tenant")!.id, c.get("member")!.userId, c.req.valid("param").id)), 200))
