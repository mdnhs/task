import { requireModule } from "../../core/middleware/module"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"

/**
 * TEST-ONLY probes (registered by createApp only when NODE_ENV=test; plain Hono routes, never in the OpenAPI document).
 * Today's real routes are M0 core, so these give AC-M0-05 a real request path through requireModule and the 402 rule.
 */
export const entitlementProbeRoutes = newRouter()
  .get("/v1/_probe/m1a", requireTenant, requireModule("M1A"), (c) => c.json({ ok: true }))
  .post("/v1/_probe/write", requireTenant, (c) => c.json({ ok: true }))
