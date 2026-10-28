import { getData } from "@/lib/data"
import type { Invoice, Plan, SubscriptionRecord, Usage } from "./types"

export const getPlans = async () => getData<Plan[]>("billing/plans.json")

export async function getBilling(tenantId: string) {
  const [plans, sub, usage, invoices] = await Promise.all([
    getPlans(),
    getData<{ provider: string; tenants: Record<string, SubscriptionRecord> }>("billing/subscription.json"),
    getData<{ tenants: Record<string, Usage> }>("billing/usage.json"),
    getData<{ tenants: Record<string, Invoice[]> }>("billing/invoices.json"),
  ])
  const record = sub.tenants[tenantId]
  return { plans, provider: sub.provider, subscription: record, usage: usage.tenants[tenantId], invoices: invoices.tenants[tenantId] ?? [] }
}

/** Seat limit (FR-SAAS-06) of the plan a tenant is on. Trial tenants use their subscription's plan. */
export async function getSeatLimit(tenantId: string): Promise<{ limit: number; planName: string }> {
  const { plans, subscription } = await getBilling(tenantId)
  const plan = plans.find((p) => p.id === subscription?.planId) ?? plans[0]
  return { limit: plan.limits.activeUsers, planName: plan.name }
}
