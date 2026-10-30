import type { Metadata } from "next"
import { DEFAULT_APPEARANCE } from "@/lib/appearance"
import { notFound } from "next/navigation"

import { BillingView, getBilling, getEntitlements, getSeatLimit } from "@/features/billing"
import {
  BrandingPanel, DepartmentsPanel, DevicePolicyCard, DevicesPanel, IntegrationsPanel, MfaPolicyCard, NotificationsPanel, OrganisationForm, PrivacyPanel, RolesMatrix, SETTINGS_TABS,
  SettingsLayout, TemplatePanel, UsersPanel, getBranding, getDeliveryLog, getDepartments, getIntegrations, getNotificationSettings, getOrganisation,
  getPrivacy, getRolesMatrix, getTemplate, getUsersAndInvites, isTab,
} from "@/features/settings"
import type { SettingsTabId } from "@/features/settings"
import { AccessRestricted, getUser } from "@/features/shell"
import { getDeviceRegister } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"
import { getSupportAccess } from "@/lib/support-data"

export const dynamicParams = false

export function generateStaticParams() {
  return SETTINGS_TABS.map((t) => ({ tab: t.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params
  const t = SETTINGS_TABS.find((x) => x.id === tab)
  return { title: t ? `${t.label} · Settings · OpsDesk` : "Settings · OpsDesk" }
}

export default async function Page({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  if (!isTab(tab)) notFound()
  const [session, org] = await Promise.all([getSession(), getOrg()])
  if (!can(session.role, "settings")) return <AccessRestricted moduleLabel="Settings" />

  const write = canWrite(session, "settings")
  const scopeKey = session.tenant.id
  const { tenant } = session

  async function body(tab: SettingsTabId) {
    switch (tab) {
      case "organisation":
        return <OrganisationForm data={await getOrganisation()} name={tenant.name} slug={tenant.slug} timezone={org.timezone} tzLabel={org.tzLabel} deadline={org.deadline} canWrite={write} />
      case "departments": {
        const [departments, { users }] = await Promise.all([getDepartments(), getUsersAndInvites()])
        return <DepartmentsPanel departments={departments} owners={users.filter((u) => u.status === "active").map((u) => u.name)} canWrite={write} scopeKey={scopeKey} />
      }
      case "users": {
        const [{ users, invites }, seats] = await Promise.all([getUsersAndInvites(), getSeatLimit(tenant.id)])
        return (
          <UsersPanel
            users={users}
            invites={invites}
            roles={session.roles.filter((r) => !r.platform).map((r) => ({ id: r.id, label: r.label }))}
            departments={org.departments}
            today={org.today}
            tzLabel={org.tzLabel}
            seatLimit={seats.limit}
            planName={seats.planName}
            canWrite={write}
            scopeKey={scopeKey}
          />
        )
      }
      case "roles": {
        const [matrix, reg] = await Promise.all([getRolesMatrix(), getDeviceRegister(session)])
        return (
          <>
            <RolesMatrix data={matrix} canWrite={write} scopeKey={scopeKey} />
            <MfaPolicyCard policy={reg.mfaPolicy} roles={session.roles.filter((r) => !r.platform).map((r) => ({ id: r.id, label: r.label }))} canWrite={write} scopeKey={scopeKey} />
          </>
        )
      }
      case "template":
        return <TemplatePanel data={await getTemplate()} canWrite={write} scopeKey={scopeKey} />
      case "notifications":
        return <NotificationsPanel data={await getNotificationSettings()} deadline={org.deadline} tzLabel={org.tzLabel} today={org.today} timezone={org.timezone} log={await getDeliveryLog()} canWrite={write} scopeKey={scopeKey} />
      case "integrations": {
        const [integrations, reg] = await Promise.all([getIntegrations(), getDeviceRegister(session)])
        return (
          <>
            <IntegrationsPanel integrations={integrations} today={org.today} tzLabel={org.tzLabel} canWrite={write} scopeKey={scopeKey} />
            <DevicePolicyCard policies={reg.policies} canWrite={write} scopeKey={scopeKey} />
          </>
        )
      }
      case "devices": {
        const [reg, { users }] = await Promise.all([getDeviceRegister(session), getUsersAndInvites()])
        return <DevicesPanel devices={reg.devices} users={users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }))} today={org.today} tzLabel={org.tzLabel} canWrite={write} scopeKey={scopeKey} />
      }
      case "branding":
        return <BrandingPanel tenantId={tenant.id} name={tenant.name} color={tenant.brand} appearance={tenant.appearance ?? DEFAULT_APPEARANCE} presets={(await getBranding()).presets} canWrite={write} />
      case "billing": {
        const b = await getBilling(tenant.id)
        if (!b.subscription) return null
        return (
          <BillingView
            plans={b.plans}
            tenantId={tenant.id}
            planId={b.subscription.planId}
            status={tenant.status}
            graceEndsOn={tenant.graceEndsOn}
            trialEndsOn={tenant.trialEndsOn}
            renewsOn={b.subscription.renewsOn}
            cardLast4={b.subscription.cardLast4}
            provider={b.provider}
            usage={b.usage}
            invoices={b.invoices}
            today={org.today}
            tzLabel={org.tzLabel}
            // Not canWrite: a suspended (read-only) tenant owner must still reach billing to pay; read-only roles stay excluded.
            canManage={can(session.role, "settings", "write")}
            locale={org.locale}
            entitlements={await getEntitlements()}
          />
        )
      }
      case "privacy":
      {
        // Only this tenant's rows reach the client; the platform console seeds the rest.
        const [data, rows, user] = await Promise.all([getPrivacy(), getSupportAccess(), getUser()])
        return (
          <PrivacyPanel
            data={data}
            requests={rows.filter((r) => r.tenantId === tenant.id)}
            tenantId={tenant.id}
            actor={user.name}
            companyName={tenant.name}
            today={org.today}
            tzLabel={org.tzLabel}
            // FR-SET-08 / FR-SAAS-15: support grants, full export and deletion are Tenant Owner only; others see the list read-only.
            canWrite={write && session.role.id === "owner"}
          />
        )
      }
    }
  }

  // All panels render up front so the client switches tabs in place (small seed data; no per-tab round-trip).
  const rendered = await Promise.all(SETTINGS_TABS.map(async (t) => [t.id, await body(t.id)] as const))
  const panels = Object.fromEntries(rendered.filter(([, node]) => node != null)) as Partial<Record<SettingsTabId, React.ReactNode>>
  if (!panels[tab]) notFound()

  return <SettingsLayout tab={tab} readOnly={!write} panels={panels} />
}
