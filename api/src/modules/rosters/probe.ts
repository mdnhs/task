import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../../core/context"
import { withTenant } from "../../db/tenant-tx"
import { newRouter } from "../../core/router"
import { assertLocation, loadRosterCtx, lockRoster, rosterGuard } from "./scope"

/**
 * TEST-ONLY probes (createApp registers them only when NODE_ENV=test; plain Hono routes, never in the OpenAPI document). They give the roster access
 * boundary a real request path before the roster routes exist: the guard stack, a location the caller cannot see, and the write path (lock order).
 */
const guard = (need: "read" | "write") => rosterGuard(need) as [MiddlewareHandler<AppEnv>, MiddlewareHandler<AppEnv>, MiddlewareHandler<AppEnv>]

export const rosterProbeRoutes = newRouter()
  .get("/v1/_probe/roster", ...guard("read"), async (c) => {
    const ctx = await withTenant(c.get("deps").db, c.get("tenant")!.id, (tx) => loadRosterCtx(c, tx))
    return c.json({ scope: ctx.access.scope, locationIds: ctx.access.locationIds, editDraft: ctx.access.editDraft, editPublished: ctx.access.editPublished, approve: ctx.access.approve })
  })
  .get("/v1/_probe/roster/locations/:id", ...guard("read"), async (c) => {
    const id = c.req.param("id")!
    await withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => assertLocation(await loadRosterCtx(c, tx), id))
    return c.json({ ok: true })
  })
  .post("/v1/_probe/roster-write", ...guard("write"), async (c) => {
    const ctx = await withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => {
      await lockRoster(tx, c.get("tenant")!.id)
      return loadRosterCtx(c, tx, "write")
    })
    return c.json({ me: ctx.me, scope: ctx.access.scope })
  })
