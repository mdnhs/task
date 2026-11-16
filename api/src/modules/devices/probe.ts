import { WITHHELD_DRIVE_NAME, withholdDriveLinks } from "@opsdesk/domain/devices"
import { driveAllowed, requireFeatureOnDevice } from "../../core/middleware/device"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"

const DRIVE_URL = "https://drive.google.com/file/d/probe/view"

/**
 * TEST-ONLY probes (registered by createApp only when NODE_ENV=test). Plain Hono routes, not `.openapi(...)`, so they are
 * never part of the OpenAPI document. They give the device-policy tests a real request path through the real guards.
 */
export const probeRoutes = newRouter()
  .get("/v1/_probe/drive-links", requireTenant, (c) => {
    if (driveAllowed(c)) return c.json({ links: [DRIVE_URL] })
    const out = withholdDriveLinks([{ evidence: [{ kind: "drive", name: "Plan", url: DRIVE_URL }] }])
    const evidence = out.flatMap((t) => t.evidence)
    return c.json({ links: evidence.flatMap((e) => (e.url ? [e.url] : [])), withheld: evidence.filter((e) => e.name === WITHHELD_DRIVE_NAME).length })
  })
  .get("/v1/_probe/payroll", requireTenant, requireFeatureOnDevice("payroll"), (c) => c.json({ ok: true }))
