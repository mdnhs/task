import type { Metadata } from "next"
import { DEFAULT_APPEARANCE } from "@/lib/appearance"
import { notFound } from "next/navigation"

import { BillingView, getBilling, getEntitlements, getPlans, getSeatLimit, moduleRows, planCards } from "@/features/billing"
import {
  BrandingPanel, DepartmentsPanel, DevicePolicyCard, DevicesPanel, IntegrationsPanel, MfaPolicyCard, NotificationsPanel, OrganisationForm, PrivacyPanel, RolesMatrix, SETTINGS_TABS,
  SettingsLayout, TemplatePanel, UsersPanel, getBrandingPresets, getDeliveryLog, getNames, getNotificationSettings, getOrganisationOptions, getMockUserActivity, loadReportTemplate, isTab, loadBranding, loadSessionIdleHours,
  loadDepartments, loadDevices, loadIntegrations, loadInvites, loadMatrix, loadMfaPolicy, loadMyExports, loadOrganisation, loadPolicies, loadRequests, loadUsers, nameOfFrom, readable, serverApi,
} from "@/features/settings"
import { LOGO_UPLOAD_ENABLED } from "@/features/settings/constants"
import type { SettingsTabId } from "@/features/settings"
import { AccessRestricted } from "@/features/shell"
import { WhatsAppCard, WhatsAppCardError, WhatsAppCount, getWhatsApp } from "@/features/whatsapp"
import { hasModule } from "@/lib/entitlements"
import { mockEnabled } from "@/lib/mock-registry"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"
import { canWhileBlocked } from "@/lib/billing-state"

export const dynamicParams = false

export function generateStaticParams() {
  return SETTINGS_TABS.map((t) => ({ tab: t.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params
  const t = SETTINGS_TABS.find((x) => x.id === tab)
  return { title: t ? `${t.label} · Settings · OpsDesk` : "Settings · OpsDesk" }
}

export default async function Page({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<{ status?: string }> }) {
  const { tab } = await params
  if (!isTab(tab)) notFound()
  // This page calls the API (billing, entitlements, the company clock): it gates itself on the second factor first (the API refuses tenant reads until then).
  const session = await requireMfaOk()
  const org = await getOrg()
  if (!can(session.role, "settings")) return <AccessRestricted moduleLabel="Settings" />
  const { status } = await searchParams
  const flash: { status: "connected" | "error" } | undefined = tab === "integrations" && (status === "connected" || status === "error") ? { status } : undefined

  const write = canWrite(session, "settings")
  const { tenant } = session
  const api = await serverApi()
  const owner = session.role.id === "owner"
  const admin = owner || session.role.id === "admin"
  const names = await getNames()
  const nameOf = nameOfFrom(names)

  // A tab this member may not read (403) or whose module is not in the plan answers null and is left out: permission-hidden, never an error page.
  async function body(tab: SettingsTabId) {
    switch (tab) {
      case "organisation": {
        const [o, options, idle] = await Promise.all([readable(() => loadOrganisation(api)), getOrganisationOptions(), readable(() => loadSessionIdleHours(api))])
        return o && <OrganisationForm options={options} org={o} tzLabel={org.tzLabel} sessionIdleHours={idle} canWrite={write} />
      }
      case "departments": {
        const d = await readable(() => loadDepartments(api))
        return d && <DepartmentsPanel departments={d} canWrite={write} />
      }
      case "users": {
        const [users, roles, invites, seats] = await Promise.all([
          readable(() => loadUsers(api)), readable(() => loadMatrix(api)), readable(() => loadInvites(api, org.timezone)), getSeatLimit(),
        ])
        if (!users || !roles) return null
        const mockActivity = mockEnabled() ? await getMockUserActivity() : undefined // MOCK (J2): deactivate and last active, demo deployments only
        const waUsers = mockEnabled() ? await getWhatsApp().catch(() => null) : null // MOCK: staged WhatsApp numbers, demo deployments only
        const whatsapp = waUsers ? { countries: waUsers.countries, status: Object.fromEntries(waUsers.people.map((p) => [p.email.toLowerCase(), p.status])), scope: tenant.id } : undefined
        return <UsersPanel meId={session.user.id} mockActivity={mockActivity} whatsapp={whatsapp} users={users} invites={invites ?? []} roles={roles.roles} today={org.today} tzLabel={org.tzLabel} seatLimit={seats.limit} seatsUsed={seats.used} planName={seats.planName} canWrite={write} />
      }
      case "roles": {
        const [matrix, policy] = await Promise.all([readable(() => loadMatrix(api)), readable(() => loadMfaPolicy(api))])
        if (!matrix) return null
        return (
          <>
            <RolesMatrix data={matrix} canWrite={write} />
            {policy && <MfaPolicyCard policy={policy} roles={matrix.roles.map((r) => ({ id: r.id, label: r.label }))} canWrite={write} />}
          </>
        )
      }
      case "template": {
        const t = await readable(() => loadReportTemplate(api))
        return t && <TemplatePanel data={t.data} etag={t.etag} canWrite={write} />
      }
      // MOCK: no backend until B9 (tenant-default notification settings and the delivery log): demo deployments only (I16).
      case "notifications":
        return mockEnabled() ? <NotificationsPanel data={await getNotificationSettings()} deadline={org.deadline} tzLabel={org.tzLabel} today={org.today} timezone={org.timezone} log={await getDeliveryLog()} canWrite={write} scopeKey={tenant.id} /> : null
      case "integrations": {
        const [integrations, policies] = await Promise.all([readable(() => loadIntegrations(api, org.timezone)), readable(() => loadPolicies(api))])
        if (!integrations) return null
        // MOCK (no backend yet): the WhatsApp card and the "N of M connected" counter, demo deployments only.
        const wa = mockEnabled() ? await getWhatsApp().catch(() => null) : null
        const extra = !mockEnabled() ? undefined : wa ? <WhatsAppCard initial={wa} scope={tenant.id} today={org.today} tzLabel={org.tzLabel} canWrite={write} /> : <WhatsAppCardError />
        const counter = wa ? <WhatsAppCount initial={wa} scope={tenant.id} base={integrations.filter((i) => i.status === "connected").length} total={Math.max(integrations.length, 1) + 1} /> : undefined
        return (
          <>
            <IntegrationsPanel integrations={integrations} flash={flash} today={org.today} tzLabel={org.tzLabel} canWrite={write} extra={extra} counter={counter} />
            {policies && <DevicePolicyCard policies={policies} canWrite={write} />}
          </>
        )
      }
      case "devices": {
        const [devices, users] = await Promise.all([readable(() => loadDevices(api, org.timezone)), readable(() => loadUsers(api))])
        if (!devices || !users) return null
        return <DevicesPanel devices={devices} users={users.map((u) => ({ id: u.id, name: u.name }))} today={org.today} tzLabel={org.tzLabel} canWrite={write} />
      }
      case "branding": {
        const [o, b, presets] = await Promise.all([readable(() => loadOrganisation(api)), readable(() => loadBranding(api)), getBrandingPresets()])
        if (!o || !b) return null
        const canUpload = LOGO_UPLOAD_ENABLED && hasModule(session.entitlements, "files") && canWrite(session, "files")
        return <BrandingPanel name={o.name} color={b.primaryColor ?? tenant.brand} logoFileId={b.logoFileId} presets={presets.presets} canWrite={write} canUpload={canUpload} />
      }
      case "billing": {
        // Owner or admin only: anyone else gets null (the tab is not offered). Not canWrite: a blocked (read-only) company's owner must still reach billing to pay.
        const [b, plans, ent] = await Promise.all([getBilling(), getPlans(), getEntitlements()])
        if (!b) return null
        return (
          <BillingView
            subscription={b.subscription}
            plans={planCards(plans, ent, b.subscription.planId)}
            modules={moduleRows(ent, session.entitlements.allowed)}
            invoices={b.invoices}
            invoicesMore={b.invoicesMore}
            today={org.today}
            timezone={org.timezone}
            tzLabel={org.tzLabel}
            locale={org.locale}
            canManage={canWhileBlocked(session, "billing")}
          />
        )
      }
      case "privacy": {
        const [mine, requests, users] = await Promise.all([
          readable(() => loadMyExports(api, org.timezone, nameOf)), admin ? readable(() => loadRequests(api, org.timezone, nameOf)) : Promise.resolve(null), admin ? readable(() => loadUsers(api)) : Promise.resolve(null),
        ])
        return (
          <PrivacyPanel
            mine={mine ?? []}
            requests={requests ?? []}
            people={(users ?? []).map((u) => ({ id: u.id, name: u.name }))}
            today={org.today}
            tzLabel={org.tzLabel}
            // FR-SET-08 / FR-SAAS-15: opening a data request is Tenant Owner only; an admin reads the list.
            canWrite={canWhileBlocked(session, "export")}
            canRequests={requests !== null}
          />
        )
      }
    }
  }

  // All panels render up front so the client switches tabs in place (small data; no per-tab round-trip).
  const rendered = await Promise.all(SETTINGS_TABS.map(async (t) => [t.id, await body(t.id)] as const))
  const panels = Object.fromEntries(rendered.filter(([, node]) => node != null)) as Partial<Record<SettingsTabId, React.ReactNode>>
  if (!panels[tab]) notFound()

  return <SettingsLayout tab={tab} readOnly={!write} panels={panels} />
}
