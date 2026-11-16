import { createRoute, z } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"
import { requireSession } from "../../core/middleware/session"
import { requireTenant } from "../../core/middleware/tenant"
import { listUserTenants } from "./me"
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
  middleware: [requireSession] as const,
  request: { body: { content: { "application/json": { schema: CreateTenant } }, required: true } },
  responses: {
    201: { description: "Tenant created; the caller is its owner", content: { "application/json": { schema: z.object({ id: z.string(), slug: z.string() }) } } },
  },
})

const meTenantRoute = createRoute({
  method: "get",
  path: "/v1/me/tenant",
  middleware: [requireTenant] as const,
  responses: { 200: { description: "Tenant and member context of the caller", content: { "application/json": { schema: z.any() } } } },
})

const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  middleware: [requireSession] as const,
  responses: { 200: { description: "The caller and their active tenants", content: { "application/json": { schema: z.object({ user: z.object({ id: z.string(), email: z.string() }), tenants: z.array(z.object({ slug: z.string(), name: z.string(), roleKey: z.string() })) }) } } } },
})

export const tenantRoutes = newRouter()
  .openapi(meRoute, async (c) => {
    const user = c.get("user")!
    return c.json({ user: { id: user.id, email: user.email }, tenants: await listUserTenants(c.get("deps").db, user.id) }, 200)
  })
  .openapi(createTenantRoute, async (c) => {
    const res = await createTenant(c.get("deps"), c.get("user")!.id, c.req.valid("json"))
    return c.json(res, 201)
  })
  .openapi(meTenantRoute, (c) => c.json({ tenant: c.get("tenant")!, member: c.get("member")! }, 200))
