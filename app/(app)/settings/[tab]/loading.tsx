import { BillingSkeleton, USAGE_ROWS, getBilling, getEntitlements } from "@/features/billing"
import { SettingsLoading, getDeliveryLog, getDepartments, getOrganisation, getIntegrations, getNotificationSettings, getRolesMatrix, getTemplate, getUsersAndInvites } from "@/features/settings"
import { PageSkeleton } from "@/features/shell"
import { planModules } from "@/lib/entitlements"
import { getDeviceRegister } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"
import { getSupportAccess } from "@/lib/support-data"

// Async so the skeleton uses the real row counts and the role's controls; the client wrapper picks the tab from the pathname.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "settings")) return <PageSkeleton />
  const [{ users, invites }, departments, matrix, template, notifications, integrations, support, billing, organisation, org, deliveryLog, reg] = await Promise.all([
    getUsersAndInvites(), getDepartments(), getRolesMatrix(), getTemplate(), getNotificationSettings(), getIntegrations(), getSupportAccess().then((rows) => rows.filter((r) => r.tenantId === session.tenant.id)), getBilling(session.tenant.id), getOrganisation(), getOrg(), getDeliveryLog(), getDeviceRegister(session),
  ])
  const counts = {
    users: users.length,
    invites: invites.length,
    departments: departments.length,
    modules: matrix.modules.length,
    roles: matrix.roles.length,
    sections: (template.departments[0]?.sections ?? []).map((sec) => (sec.enabled ? sec.fields.length : null)),
    templateDepts: template.departments.length,
    // the branding preview bar fits about 22 characters of the tenant name per line at desktop widths
    brandNameLines: session.tenant.name.length > 22 ? 2 : 1,
    events: notifications.events.length,
    intervals: notifications.intervals.length,
    integrations: integrations.length,
    grants: support.length,
    owner: session.role.id === "owner",
    data: {
      tzLabel: org.tzLabel,
      today: org.today,
      weekendRules: organisation.weekendRules.map((r) => r.label),
      departments,
      users,
      invites,
      integrations,
      grants: support,
      deadline: org.deadline,
      matrix,
      template,
      notifications,
      deliveryLog,
      devices: reg.devices,
      devicePolicies: reg.policies,
      mfaPolicy: reg.mfaPolicy,
      roleLabels: Object.fromEntries(matrix.roles.map((r) => [r.id, r.label])),
    },
  }
  const entitlements = await getEntitlements()
  const manage = can(session.role, "settings", "write")
  const sub = billing.subscription
  const plan = billing.plans.find((p) => p.id === sub?.planId) ?? billing.plans[0]
  const fullUsage = USAGE_ROWS.flatMap((r, i) => (billing.usage && billing.usage[r.key] >= plan.limits[r.key] ? [i] : []))
  return (
    <SettingsLoading
      counts={counts}
      canWrite={canWrite(session, "settings")}
      billing={<BillingSkeleton plans={billing.plans.length} invoices={billing.invoices.length} invoiceRows={billing.invoices} canManage={manage} currentIndex={Math.max(0, billing.plans.indexOf(plan))} pastDue={session.tenant.status === "past_due"} fullUsage={fullUsage} locale={org.locale} modules={planModules(entitlements, plan.id)} planName={plan.name} />}
    />
  )
}
