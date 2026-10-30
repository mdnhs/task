import Link from "next/link"

import {
  AuditTabView, BillingTabView, ChangePlanView, ExtendTrialView, ModulesTabView, OverviewTabView, ScheduleDeletionView, SettingsTabView, SupportTabView,
  Tenant360Header, UsageTabView, auditTab, billingTab, getPlatformSeed, getPlatformSettings, isTenantTab, modulesTab, overviewTab, settingsTab, supportTab,
  tabsFor, tenant360Head, usageTab,
  type PlatformAction, type StaffMember, type T360Ctx, type T360Head, type TenantTab,
} from "@/features/platform"
import { EmptyState } from "@/components/empty-state"
import { getOrg } from "@/lib/org"
import { requestPath } from "@/lib/request-path"

// Shared by the tenant 360 routes (layout, tab pages, long-form pages and their loading.tsx), so a page and its
// skeleton render the same component from the same view model (SkMask = exact by construction). Not a route file.

export type T360 = { head: T360Head; ctx: T360Ctx; tabs: TenantTab[]; tz: string; seed: Awaited<ReturnType<typeof getPlatformSeed>>; retentionDays: number }

export async function load360(id: string, op: StaffMember): Promise<T360 | null> {
  const [seed, settings, org] = await Promise.all([getPlatformSeed(), getPlatformSettings(), getOrg()])
  const head = tenant360Head(seed, id, op, settings.payments)
  if (!head) return null
  return {
    head,
    ctx: { operator: { name: op.name, role: op.role }, today: org.today, tzLabel: org.tzLabel },
    tabs: tabsFor(op),
    tz: org.timezone,
    seed,
    retentionDays: settings.retentionDays,
  }
}

/** The tenant (from the server seed, not the role-trimmed head) a tab slice is built from. */
const record = (v: T360) => v.seed.tenants.find((t) => t.id === v.head.tenant.id)!

/** One tab's body: only that tab's slice reaches the client. */
export function TabBody({ tab, v }: { tab: TenantTab; v: T360 }) {
  const { head, ctx, seed } = v
  const t = record(v)
  switch (tab) {
    case "overview":
      return <OverviewTabView head={head} data={overviewTab(seed, t)} ctx={ctx} tabs={v.tabs} />
    case "billing":
      return <BillingTabView head={head} data={billingTab(seed, t)} ctx={ctx} />
    case "usage":
      return <UsageTabView head={head} data={usageTab(seed, t)} />
    case "modules":
      return <ModulesTabView head={head} data={modulesTab(seed)} ctx={ctx} />
    case "support":
      return <SupportTabView head={head} data={supportTab(seed, t)} ctx={ctx} tz={v.tz} />
    case "audit":
      return <AuditTabView head={head} data={auditTab(seed, t)} ctx={ctx} />
    case "settings":
      return <SettingsTabView head={head} data={settingsTab(seed, t, v.retentionDays)} ctx={ctx} />
  }
}

export const Header = ({ v }: { v: T360 }) => <Tenant360Header head={v.head} ctx={v.ctx} tabs={v.tabs} />

export type FormPage = "change-plan" | "extend-trial" | "schedule-deletion"
/** D3: billing.write for plan and trial changes, tenants.lifecycle for deletion. */
export const FORM_ACTION: Record<FormPage, PlatformAction> = { "change-plan": "billing.write", "extend-trial": "billing.write", "schedule-deletion": "tenants.lifecycle" }
export const FORM_LABEL: Record<FormPage, string> = { "change-plan": "plan changes", "extend-trial": "trial extensions", "schedule-deletion": "tenant deletion" }

export function FormBody({ page, v }: { page: FormPage; v: T360 }) {
  switch (page) {
    case "change-plan":
      return <ChangePlanView head={v.head} modules={modulesTab(v.seed)} ctx={v.ctx} />
    case "extend-trial":
      return <ExtendTrialView head={v.head} ctx={v.ctx} />
    case "schedule-deletion":
      return <ScheduleDeletionView head={v.head} ctx={v.ctx} retentionDays={v.retentionDays} />
  }
}

export function TenantNotFound() {
  return (
    <>
      <Link href="/platform/tenants" className="pf-back">← Tenants</Link>
      <EmptyState icon="folder" title="Tenant not found" text="This company doesn't exist or was removed." action={<Link href="/platform/tenants" className="btn btn-outline">Back to tenants</Link>} />
    </>
  )
}

/** loading.tsx gets no params: the id and the segment after it come from the path proxy.ts forwards. */
export async function pathParts(): Promise<{ id?: string; rest?: string }> {
  const parts = (await requestPath()).split("/")
  // ["", "platform", "tenants", id, rest]
  if (parts[1] !== "platform" || parts[2] !== "tenants" || !parts[3]) return {}
  const dec = (s: string | undefined) => {
    if (!s) return undefined
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  return { id: dec(parts[3]), rest: dec(parts[4]) }
}

export const isFormPage = (s: unknown): s is FormPage => s === "change-plan" || s === "extend-trial" || s === "schedule-deletion"
export { isTenantTab }
