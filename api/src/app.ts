import { sql } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import type { Deps } from "./deps"
import { newRouter } from "./core/router"
import { AppError, problem, statusCode, statusTitle } from "./core/errors"
import { errorInfo } from "./core/safe-error"
import { requestId } from "./core/middleware/request-id"
import { auditRoutes } from "./modules/audit" // keep before any module that imports core/middleware/permission first (latent import cycle via entitlements -> audit)
import { apiKeyRoutes } from "./modules/api-keys"
import { webhookRoutes } from "./modules/webhooks-out"
import { deviceRoutes, probeRoutes } from "./modules/devices"
import { billingRoutes, billingSettingsRoutes, billingWebhookRoutes } from "./modules/billing"
import { entitlementProbeRoutes, entitlementRoutes } from "./modules/entitlements"
import { fileRoutes } from "./modules/files"
import { gdprRoutes } from "./modules/gdpr"
import { mfaRoutes } from "./modules/mfa"
import { notificationRoutes } from "./modules/notifications"
import { integrationRoutes } from "./modules/integrations"
import { searchRoutes } from "./modules/search"
import { settingsRoutes } from "./modules/settings"
import { emailSettingsRoutes } from "./modules/platform-email"
import { storageSettingsRoutes } from "./modules/platform-storage"
import { platformAuditRoutes } from "./modules/platform-audit"
import { platformStaffRoutes } from "./modules/platform-staff"
import { platformConsoleRoutes, supportGrantRoutes } from "./modules/platform-console"
import { rbacRoutes } from "./modules/rbac"
import { authRoutes } from "./modules/auth/routes"
import { inviteRoutes } from "./modules/invites"
import { collabRoutes, taskRoutes } from "./modules/tasks"
import { teamRoutes } from "./modules/teams"
import { tenantRoutes } from "./modules/tenants"

export function createApp(deps: Deps) {
  const { logger } = deps
  const app = newRouter()

  app.use("*", async (c, next) => {
    c.set("deps", deps)
    await next()
  })
  app.use("*", requestId)

  app.onError((err, c) => {
    const rid = c.get("requestId") ?? crypto.randomUUID()
    if (err instanceof AppError) return problem(err.status, err.code, err.title, rid)
    if (err instanceof HTTPException) {
      return problem(err.status, statusCode(err.status), statusTitle(err.status), rid)
    }
    logger.error({ ...errorInfo(err), requestId: rid }, "unhandled error") // never the message or object: Drizzle messages carry query params
    return problem(500, "internal", "Internal Server Error", rid)
  })
  app.notFound((c) => problem(404, "not_found", "Not Found", c.get("requestId")))

  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", async (c) => {
    try {
      await deps.db.execute(sql`select 1`)
      return c.json({ status: "ready" })
    } catch (err) {
      logger.error({ err, requestId: c.get("requestId") }, "readiness check failed")
      return c.json({ status: "unavailable" }, 503)
    }
  })

  app.route("/", authRoutes)
  app.route("/", tenantRoutes)
  app.route("/", inviteRoutes)
  app.route("/", rbacRoutes)
  app.route("/", teamRoutes)
  app.route("/", taskRoutes)
  app.route("/", collabRoutes)
  app.route("/", mfaRoutes)
  app.route("/", auditRoutes)
  app.route("/", deviceRoutes)
  app.route("/", notificationRoutes)
  app.route("/", fileRoutes)
  app.route("/", settingsRoutes)
  app.route("/", integrationRoutes)
  app.route("/", searchRoutes)
  app.route("/", gdprRoutes)
  app.route("/", platformStaffRoutes)
  app.route("/", platformAuditRoutes)
  app.route("/", platformConsoleRoutes)
  app.route("/", supportGrantRoutes)
  app.route("/", apiKeyRoutes)
  app.route("/", webhookRoutes)
  app.route("/", emailSettingsRoutes)
  app.route("/", storageSettingsRoutes)
  app.route("/", billingSettingsRoutes)
  app.route("/", entitlementRoutes)
  app.route("/", billingRoutes)
  app.route("/", billingWebhookRoutes) // outside /v1: raw body, authenticated by the provider signature
  if (deps.env.NODE_ENV === "test") app.route("/", entitlementProbeRoutes) // test-only (M1A probe, write probe)
  if (deps.env.NODE_ENV === "test") app.route("/", probeRoutes) // test-only; never registered elsewhere, not in the OpenAPI doc

  app.doc31("/v1/openapi.json", { openapi: "3.1.0", info: { title: "OpsDesk API", version: "1" } })

  return app
}

export type AppType = ReturnType<typeof createApp>
