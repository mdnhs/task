import { createRoute, z } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"
import { requireSession } from "../../core/middleware/session"
import { RATE, rateLimit } from "../../core/middleware/rate-limit"
import { requireTenant } from "../../core/middleware/tenant"
import { UNREGISTERED_ID } from "@opsdesk/domain/devices"
import { driveAllowed } from "../../core/middleware/device"
import { loadRole } from "../../core/middleware/permission"
import { withTenant } from "../../db/tenant-tx"
import { getBranding, getOrganisation } from "../settings"
import { listUserTenants, loadMe, tenantDisplayName } from "./me"
import { createTenant } from "./service"

const validTimezone = (v: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v })
    return true
  } catch {
    return false
  }
}
const validLocale = (v: string) => {
  try {
    return Intl.getCanonicalLocales(v).length === 1
  } catch {
    return false
  }
}

const CreateTenant = z
  .object({
    name: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
    timezone: z.string().refine(validTimezone).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    locale: z.string().refine(validLocale).optional(),
  })
  .openapi({ example: { name: "Coppers", slug: "coppers" } })

const createTenantRoute = createRoute({
  method: "post",
  path: "/v1/tenants",
  middleware: [requireSession, rateLimit("tenant-create", RATE.tenantCreateUser, (c) => c.get("user")!.id)] as const,
  request: { body: { content: { "application/json": { schema: CreateTenant } }, required: true } },
  responses: {
    201: { description: "Tenant created; the caller is its owner", content: { "application/json": { schema: z.object({ id: z.string(), slug: z.string() }) } } },
  },
})

const UserDto = z
  .object({ id: z.string(), email: z.string(), name: z.string(), emailVerified: z.boolean(), twoFactorEnabled: z.boolean() })
  .openapi({ example: { id: "usr_8Kq2mZ4tW1", email: "alex@example.ie", name: "Alex Byrne", emailVerified: true, twoFactorEnabled: false } })
export const MeDto = z
  .object({
    user: UserDto,
    platformRole: z.enum(["owner", "support", "billing", "viewer"]).nullable().openapi({ description: "The caller's ACTIVE platform staff role; null for everyone else" }),
    tenants: z.array(z.object({ slug: z.string(), name: z.string(), roleKey: z.string() })),
  })
  .openapi({ example: { user: { id: "usr_8Kq2mZ4tW1", email: "alex@example.ie", name: "Alex Byrne", emailVerified: true, twoFactorEnabled: false }, platformRole: null, tenants: [{ slug: "coppers", name: "Coppers", roleKey: "owner" }] } })

const MfaPolicyDto = z.object({ mode: z.enum(["off", "all", "roles"]), roles: z.array(z.string()) }).openapi({ example: { mode: "off", roles: [] } })
export const MeTenantDto = z
  .object({
    tenant: z.object({
      id: z.string(), slug: z.string(), name: z.string(), timezone: z.string(), currency: z.string(), locale: z.string(), sessionIdleHours: z.number().int(), mfaPolicy: MfaPolicyDto,
    }),
    member: z.object({
      userId: z.string(), roleId: z.string(), roleKey: z.string(),
      role: z.object({
        label: z.string(), description: z.string(), home: z.enum(["manager", "staff"]),
        access: z.record(z.string(), z.enum(["none", "read", "write"])).openapi({ description: "The caller's OWN role, module -> none|read|write (staff cannot read GET /v1/roles, so the shell gets it here)" }),
      }),
    }),
    brand: z.object({ primaryColor: z.string().nullable() }),
    reportDeadline: z.string().openapi({ description: "HH:mm, tenant-local" }),
    reportDueAfterMinutes: z.number().int(),
    device: z.object({ id: z.string().nullable().openapi({ description: "null for the unregistered browser" }), type: z.string(), label: z.string(), trusted: z.boolean() }),
    features: z.object({ drive: z.boolean().openapi({ description: "Evaluated for THIS request's device and the tenant's Drive policy" }) }),
  })
  .openapi({
    example: {
      tenant: { id: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", slug: "coppers", name: "Coppers", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12, mfaPolicy: { mode: "off", roles: [] } },
      member: { userId: "usr_8Kq2mZ4tW1", roleId: "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", roleKey: "owner", role: { label: "Tenant Owner", description: "Full control of the company workspace", home: "manager", access: { dashboard: "write", tasks: "write", settings: "write" } } },
      brand: { primaryColor: "#0A1B2C" }, reportDeadline: "17:30", reportDueAfterMinutes: 60,
      device: { id: null, type: "browser", label: "Unregistered browser", trusted: false }, features: { drive: false },
    },
  })

const meTenantRoute = createRoute({
  method: "get",
  path: "/v1/me/tenant",
  middleware: [requireTenant] as const,
  responses: { 200: { description: "Tenant and member context of the caller, with the brand, the report deadline, this request's device and Drive availability (staff cannot read settings, so the shell reads them here)", content: { "application/json": { schema: MeTenantDto } } } },
})

const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  middleware: [requireSession] as const,
  responses: { 200: { description: "The caller and their active tenants", content: { "application/json": { schema: MeDto } } } },
})

export const tenantRoutes = newRouter()
  .openapi(meRoute, async (c) => {
    const user = c.get("user")!
    const db = c.get("deps").db
    const [me, tenants] = await Promise.all([loadMe(db, user.id), listUserTenants(db, user.id)])
    return c.json({ user: { id: user.id, email: user.email, name: me.name, emailVerified: me.emailVerified, twoFactorEnabled: me.twoFactorEnabled }, platformRole: me.platformRole, tenants }, 200)
  })
  .openapi(createTenantRoute, async (c) => {
    const res = await createTenant(c.get("deps"), c.get("user")!.id, c.req.valid("json"))
    return c.json(res, 201)
  })
  .openapi(meTenantRoute, async (c) => {
    const { tenant, member } = { tenant: c.get("tenant")!, member: c.get("member")! }
    const deps = c.get("deps")
    const [name, role, { org, brand }] = await Promise.all([
      tenantDisplayName(deps.db, tenant.id),
      loadRole(c),
      withTenant(deps.db, tenant.id, async (tx) => ({ org: await getOrganisation(tx, tenant.id), brand: await getBranding(tx, tenant.id) })),
    ])
    const d = c.get("device") // unset on the support-grant and API-key paths: the unregistered browser
    return c.json(
      {
        tenant: { ...tenant, name },
        member: { ...member, role: { label: role.label, description: role.description, home: role.home, access: role.access } },
        brand: { primaryColor: brand.primaryColor },
        reportDeadline: org.reportDeadline,
        reportDueAfterMinutes: org.reportDueAfterMinutes,
        device: d ? { id: d.id === UNREGISTERED_ID ? null : d.id, type: d.type, label: d.label, trusted: d.trusted } : { id: null, type: "browser", label: "Unregistered browser", trusted: false },
        features: { drive: driveAllowed(c) },
      },
      200,
    )
  })
