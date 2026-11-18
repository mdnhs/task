import { BillingSkeleton, getEntitlements, getPlans } from "@/features/billing"
import { SettingsLoading } from "@/features/settings"
import { WhatsAppCardSkeleton } from "@/features/whatsapp"
import { mockEnabled } from "@/lib/mock-registry"
import { planModules } from "@/lib/entitlements"
import { getSkeletonSession } from "@/lib/skeleton-session"
import { can, canWrite } from "@/lib/permissions"
import { PageSkeleton } from "@/features/shell"

// Static (B6 I9, K1): never calls the API. The skeleton shows the typical company: a few people, one invite, two departments, one device, the full role matrix; the
// real page then replaces it. The static plan table sizes the billing tab. T6.9 browser-measures every changed panel.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "settings")) return <PageSkeleton />
  const counts = {
    users: 3, invites: 1, departments: 2, modules: 13, roles: 11, sections: [], templateDepts: 1, brandNameLines: 1,
    events: 0, intervals: 0, integrations: 1, devices: 2, requests: 1, owner: session.role.id === "owner", canRequests: session.role.id === "owner" || session.role.id === "admin",
  }
  const [plans, entitlements] = await Promise.all([getPlans(), getEntitlements()])
  const manage = can(session.role, "settings", "write")
  const plan = plans.find((p) => p.id === session.entitlements.planId) ?? plans[0]!
  return (
    <SettingsLoading
      counts={counts}
      canWrite={canWrite(session, "settings")}
      extras={mockEnabled() ? { integrations: <WhatsAppCardSkeleton canWrite={canWrite(session, "settings")} /> } : undefined} // the mock WhatsApp card (demo flag only)
      billing={<BillingSkeleton plans={plans.length} invoices={0} subscribed={false} canManage={manage} currentIndex={Math.max(0, plans.indexOf(plan))} modules={planModules(entitlements, plan.id)} planName={plan.name} />}
    />
  )
}
