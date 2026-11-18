// Where getSession sends a missing or stale od-tenant. GET never writes (it answers a form that posts itself); POST sets od-tenant from the memberships
// the API confirms, same-origin only, then 303 to a safe path (lib/session-route.ts).
import { repairTenant, repairTenantPage } from "@/lib/session-route"

export const dynamic = "force-dynamic"

export const GET = (req: Request) => repairTenantPage(req)
export const POST = (req: Request) => repairTenant(req)
