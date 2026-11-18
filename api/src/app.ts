import { HTTPException } from "hono/http-exception"
import type { Deps } from "./deps"
import { newRouter } from "./core/router"
import { AppError, problem, statusCode, statusTitle } from "./core/errors"
import { errorInfo } from "./core/safe-error"
import { accessLog, routeTemplate } from "./core/observability/access-log"
import { safeCapture } from "./core/observability/error-reporter"
import { readiness } from "./core/observability/readiness"
import { requestId } from "./core/middleware/request-id"
import { secureHeaders } from "./core/middleware/secure-headers"
import { requireSameOrigin } from "./core/middleware/origin"
import { auditRoutes } from "./modules/audit" // keep before any module that imports core/middleware/permission first (latent import cycle via entitlements -> audit)
import { apiKeyRoutes } from "./modules/api-keys"
import { webhookRoutes } from "./modules/webhooks-out"
import { deviceRoutes, probeRoutes } from "./modules/devices"
import { billingRoutes, billingSettingsRoutes, billingWebhookRoutes } from "./modules/billing"
import { entitlementProbeRoutes, entitlementRoutes } from "./modules/entitlements"
import { rosterProbeRoutes } from "./modules/rosters"
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
import { authProviderRoutes } from "./modules/auth/providers-route"
import { meSessionRoutes } from "./modules/me"
import { inviteRoutes } from "./modules/invites"
import { archiveRoutes, collabRoutes, planningRoutes, taskRoutes, taskViewRoutes, voiceRoutes } from "./modules/tasks"
import { evidenceRoutes } from "./modules/task-evidence"
import { projectRoutes } from "./modules/projects"
import { templateRoutes } from "./modules/task-templates"
import { shiftRoutes } from "./modules/shifts"
import { shiftReportRoutes } from "./modules/shift-reports"
import { readModelRoutes } from "./modules/read-models"
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
  app.use("*", accessLog()) // request context, one access-log line per request, http metrics; after the request id, before the security headers
  app.use("*", secureHeaders()) // sets headers after next(), so error and 404 responses are covered
  app.use("/v1/*", requireSameOrigin) // CSRF layer 2 (B6 I6): a foreign Origin on a non-GET call is 403 bad_origin, before any auth
  // F18: a write that succeeded through THIS instance drops that tenant's read-model cache (a read model is derived from tasks, shifts, reports and settings) and bumps the shared Redis stamp so the other instances drop theirs at once (B7 S11; Redis down: they catch up within the 30 s TTL).
  // Conservative on purpose: any successful non-GET request of a tenant busts it, the tenant is the one the request resolved.
  app.use("/v1/*", async (c, next) => {
    await next()
    const m = c.req.method
    const tenant = c.get("tenant")
    if (tenant && m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && c.res.status < 400) await deps.readModelCache.bust(tenant.id)
  })

  app.onError((err, c) => {
    const rid = c.get("requestId") ?? crypto.randomUUID()
    if (err instanceof AppError) {
      const res = problem(err.status, err.code, err.title, rid, err.extra)
      for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v)
      return res
    }
    if (err instanceof HTTPException) {
      return problem(err.status, statusCode(err.status), statusTitle(err.status), rid)
    }
    // Postgres 40P01 (deadlock detected) and 40001 (serialisation failure) roll the transaction back and are transient: 409 `retry`, the client repeats the request (R9: the SQLSTATE is read from .cause.code).
    const info = errorInfo(err)
    // 55P03 (lock_not_available) is the same kind of transient: the roster lock waited past its lock_timeout (lockRoster).
    if (info.code === "40P01" || info.code === "40001" || info.code === "55P03") {
      logger.warn({ ...info, requestId: rid }, "transient database conflict")
      return problem(409, "retry", "Conflict", rid)
    }
    // Unhandled: one report (the default reporter logs only the class name and the pg code: Drizzle messages carry query params), a generic body, never a stack.
    const tenantId = c.get("tenant")?.id
    const userId = c.get("user")?.id ?? c.get("session")?.userId
    safeCapture(deps.errorReporter, err, { requestId: rid, route: routeTemplate(c), ...(tenantId ? { tenantId } : {}), ...(userId ? { userId } : {}) })
    return problem(500, "internal", "Internal Server Error", rid)
  })
  app.notFound((c) => problem(404, "not_found", "Not Found", c.get("requestId")))

  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", async (c) => {
    const r = await readiness(deps)
    return c.json({ status: r.status }, r.status === "ready" ? 200 : 503) // ok / not ok only; the details are on the internal metrics port. /readyz is not routed to the internet (only the web and /webhooks/* are): it is the deploy gate and a private health probe
  })

  app.route("/", authRoutes)
  app.route("/", authProviderRoutes)
  app.route("/", meSessionRoutes)
  app.route("/", tenantRoutes)
  app.route("/", inviteRoutes)
  app.route("/", rbacRoutes)
  app.route("/", teamRoutes)
  app.route("/", taskViewRoutes) // static /v1/tasks/{archive,board,calendar} before /v1/tasks/{id}
  app.route("/", taskRoutes)
  app.route("/", archiveRoutes)
  app.route("/", collabRoutes)
  app.route("/", voiceRoutes)
  app.route("/", planningRoutes)
  app.route("/", evidenceRoutes)
  app.route("/", projectRoutes)
  app.route("/", templateRoutes)
  app.route("/", shiftRoutes)
  app.route("/", shiftReportRoutes)
  app.route("/", readModelRoutes)
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
  if (deps.env.NODE_ENV === "test") app.route("/", rosterProbeRoutes) // test-only (roster access boundary probes)
  if (deps.env.NODE_ENV === "test") app.route("/", probeRoutes) // test-only; never registered elsewhere, not in the OpenAPI doc

  app.doc31("/v1/openapi.json", { openapi: "3.1.0", info: { title: "OpsDesk API", version: "1" } })

  return app
}

export type AppType = ReturnType<typeof createApp>
