// Where getSession sends a missing or stale od-tenant: sets it from the memberships the API confirms, then back to a safe path (lib/session-route.ts).
import { repairTenant } from "@/lib/session-route"

export const dynamic = "force-dynamic"

export const GET = (req: Request) => repairTenant(req)
