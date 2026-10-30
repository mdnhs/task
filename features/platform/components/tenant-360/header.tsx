"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion } from "motion/react"

import { CopyId } from "@/components/copy-id"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { layoutTransition } from "@/lib/motion"
import { canRetry } from "../../billing"
import { TENANT_TABS, tenantPath, type T360Head } from "../../tenant-360"
import { TENANT_STATUS } from "../../types"
import type { TenantTab } from "../../types"
import { HealthPill } from "../tenant-table"
import { CreditDialog, ExportDialog, SuspendDialog } from "./dialogs"
import { invoiceActions } from "../invoice-actions"
import { useLiveInvoices, useLiveTenant, type T360Ctx } from "./live"

type Dialog = "suspend" | "credit" | "export" | null

/** The tenant 360 header (Task 5): identity, status and health, the primary action for the state, a menu for the rest, the tab seg. */
export function Tenant360Header({ head, ctx, tabs }: { head: T360Head; ctx: T360Ctx; tabs: TenantTab[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const unpaid = useLiveInvoices(head.unpaid)
  const [dialog, setDialog] = useState<Dialog>(null)
  const { can } = head
  const plan = head.plans.find((p) => p.id === t.plan)
  const health = head.health[t.status]
  const active = (pathname.split("/")[4] ?? "overview") as TenantTab
  const retry = unpaid.find(canRetry)

  const { onRetry: retryInvoice } = invoiceActions({ ...ctx, provider: head.provider }, unpaid)
  const onRetry = () => retry && retryInvoice(retry)

  // The primary action follows the state; everything else is in the menu.
  const primary =
    t.status === "past_due" && can.billing && retry ? (
      <button type="button" className="btn btn-primary" onClick={onRetry} title={retry.hasPaymentMethod ? undefined : "No payment method on file: the charge will fail"}>
        <Icon name="receipt" />
        Retry payment
      </button>
    ) : t.status === "trial" && can.billing ? (
      <Link href={tenantPath(t.id, "extend-trial")} className="btn btn-primary">
        <Icon name="clock" />
        Extend trial
      </Link>
    ) : t.status === "suspended" && can.suspend ? (
      <button type="button" className="btn btn-primary" onClick={() => setDialog("suspend")}>
        <Icon name="unlock" />
        Reactivate
      </button>
    ) : null

  const items = [
    can.billing && t.status !== "suspended" && { key: "plan", icon: "layers", label: "Change plan", go: () => router.push(tenantPath(t.id, "change-plan")) },
    can.billing && { key: "credit", icon: "wallet", label: "Apply credit", go: () => setDialog("credit") },
    can.support && { key: "support", icon: "help", label: "Request support access", go: () => router.push(`/platform/support?request=${encodeURIComponent(t.id)}`) },
    can.dataRequests && { key: "export", icon: "download", label: "Export tenant data", go: () => setDialog("export") },
  ].filter(Boolean) as { key: string; icon: string; label: string; go(): void }[]
  const danger = [
    can.suspend && t.status !== "suspended" && { key: "suspend", icon: "lock", label: "Suspend", go: () => setDialog("suspend") },
    can.lifecycle && !t.deletionAt && { key: "delete", icon: "trash", label: "Schedule deletion", go: () => router.push(tenantPath(t.id, "schedule-deletion")) },
  ].filter(Boolean) as { key: string; icon: string; label: string; go(): void }[]

  return (
    <>
      <Link href="/platform/tenants" className="pf-back">← Tenants</Link>
      <div className="head pf-360-head">
        <div className="pf-360-id">
          <h1>{t.name}</h1>
          <div className="pf-360-meta">
            <StatusPill status={TENANT_STATUS[t.status]} />
            {health && <HealthPill health={health} id="pf-360-health" />}
            <span className="pf-360-plan">{plan ? `${plan.name} plan` : t.plan}</span>
            <span className="pf-slug pf-360-slug">
              <span className="num">{t.slug}</span>
              <span aria-hidden="true">·</span>
              <span className="num">{t.id}</span>
              <CopyId value={t.id} what="tenant ID" />
            </span>
          </div>
        </div>
        {(primary || items.length > 0 || danger.length > 0) && (
          <div className="head-actions">
            {primary}
            {(items.length > 0 || danger.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" className="btn btn-outline pf-360-more" aria-label={`More actions for ${t.name}`} />}>
                  <Icon name="more" />
                  <span className="pf-360-more-lbl">More</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="od-menu pf-row-menu">
                  {items.map((i) => (
                    <DropdownMenuItem key={i.key} onClick={i.go}><Icon name={i.icon} />{i.label}</DropdownMenuItem>
                  ))}
                  {danger.length > 0 && items.length > 0 && <DropdownMenuSeparator />}
                  {danger.map((i) => (
                    <DropdownMenuItem key={i.key} className="pf-danger" onClick={i.go}><Icon name={i.icon} />{i.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* Route segs (rule 30): each tab is its own URL; the pill slides between them. */}
      <nav className="seg od-seg pf-360-tabs" aria-label={`${t.name} sections`}>
        {TENANT_TABS.filter((x) => tabs.includes(x.id)).map((x) => (
          <Link key={x.id} href={tenantPath(t.id, x.id)} aria-current={x.id === active ? "page" : undefined} scroll={false}>
            {x.id === active && <motion.span layoutId="pf-360-tab" className="seg-ind" transition={layoutTransition} />}
            <span className="seg-lbl">{x.label}</span>
          </Link>
        ))}
      </nav>

      {can.suspend && <SuspendDialog tenant={t} ctx={ctx} open={dialog === "suspend"} onOpenChange={(o) => setDialog(o ? "suspend" : null)} />}
      {can.billing && <CreditDialog tenant={t} ctx={ctx} currency={plan?.currency ?? ""} open={dialog === "credit"} onOpenChange={(o) => setDialog(o ? "credit" : null)} />}
      {can.dataRequests && <ExportDialog tenant={t} ctx={ctx} dsrFloor={head.ids.dsr} open={dialog === "export"} onOpenChange={(o) => setDialog(o ? "export" : null)} />}
    </>
  )
}
