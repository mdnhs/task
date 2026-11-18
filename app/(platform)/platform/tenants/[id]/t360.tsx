import Link from "next/link"
import { BackLink } from "@/components/back-link"

import {
  BillingTabView, ChangePlanView, ScheduleDeletionView, SettingsTabView, UsageTabView, billingTab, getPlatformSeed, getPlatformSettings, modulesTab, settingsTab, tenant360Head, tabsFor, usageTab,
  type StaffMember, type T360Ctx, type T360Head, type TenantTab,
} from "@/features/platform"
import { EmptyState } from "@/components/empty-state"
import { getMockOrg } from "@/lib/org"

// The MOCK side of the tenant 360 (B6 I16): billing, usage and settings tabs, change plan and schedule deletion run on the seed (public/data/platform), and only when ENABLE_MOCK_MODULES=1.
// A real tenant is not in the seed, so on a real database the mock tabs say so. The live 360 (overview, modules, support, audit, extend trial) is in features/platform/components/live-360.tsx.

export type T360 = { head: T360Head; ctx: T360Ctx; tabs: TenantTab[]; tz: string; seed: Awaited<ReturnType<typeof getPlatformSeed>>; retentionDays: number }

export async function loadMock360(id: string, op: StaffMember): Promise<T360 | null> {
  const [seed, settings, org] = await Promise.all([getPlatformSeed(), getPlatformSettings(), getMockOrg()])
  const head = tenant360Head(seed, id, op, settings.payments)
  if (!head) return null
  return { head, ctx: { operator: { name: op.name, role: op.role }, today: org.today, tzLabel: org.tzLabel }, tabs: tabsFor(op), tz: org.timezone, seed, retentionDays: settings.retentionDays }
}

const record = (v: T360) => v.seed.tenants.find((t) => t.id === v.head.tenant.id)!

export function MockTabBody({ tab, v }: { tab: "billing" | "usage" | "settings"; v: T360 }) {
  const { head, ctx, seed } = v
  const t = record(v)
  switch (tab) {
    case "billing":
      return <BillingTabView head={head} data={billingTab(seed, t)} ctx={ctx} />
    case "usage":
      return <UsageTabView head={head} data={usageTab(seed, t)} />
    case "settings":
      return <SettingsTabView head={head} data={settingsTab(seed, t, v.retentionDays)} ctx={ctx} />
  }
}

export function MockFormBody({ page, v }: { page: "change-plan" | "schedule-deletion"; v: T360 }) {
  return page === "change-plan" ? <ChangePlanView head={v.head} modules={modulesTab(v.seed)} ctx={v.ctx} /> : <ScheduleDeletionView head={v.head} ctx={v.ctx} retentionDays={v.retentionDays} />
}

export function MockNotInSeed() {
  return <EmptyState icon="folder" title="Sample data only" text="This section has no platform API yet, and this company is not in the sample data." />
}

export function TenantNotFound() {
  return (
    <>
      <BackLink href="/platform/tenants">Tenants</BackLink>
      <EmptyState icon="folder" title="Tenant not found" text="This company doesn't exist or was removed." action={<Link href="/platform/tenants" className="btn btn-outline">Back to tenants</Link>} />
    </>
  )
}
