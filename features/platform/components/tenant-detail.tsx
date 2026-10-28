"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { auditEntry, canSuspend, dateY, money, nowIso, planOf, reactivateTenant, suspendTenant, tenantMrr } from "../logic"
import { usePlatform } from "../store"
import { LIMITS, TENANT_STATUS } from "../types"
import type { PlatformSeed } from "../types"
import { SlugConfirmDialog } from "./slug-confirm-dialog"

const num = (n: number) => n.toLocaleString("en-GB")

export function TenantDetail({ seed, id, today, tzLabel, actor }: { seed: PlatformSeed; id: string; today: string; tzLabel: string; actor: string }) {
  const { tenants, setTenants, plans, setAudit } = usePlatform(seed)
  const [confirming, setConfirming] = useState(false)
  const tenant = tenants.find((t) => t.id === id)

  if (!tenant) {
    return (
      <>
        <Link href="/platform" className="pf-back">← Tenants</Link>
        <EmptyState icon="folder" title="Tenant not found" text="This company doesn't exist or was removed." action={<Link href="/platform" className="btn btn-outline">Back to tenants</Link>} />
      </>
    )
  }

  const plan = planOf(plans, tenant.plan)
  const suspended = !canSuspend(tenant)
  const mrr = tenantMrr(tenant, plans)
  const currency = plan?.currency ?? "GBP"
  const stamp = `${dateY(nowIso(today))} ${tzLabel}`

  function toggle() {
    const at = nowIso(today)
    const t = tenant!
    setTenants((all) => all.map((x) => (x.id === t.id ? (suspended ? reactivateTenant(x) : suspendTenant(x, at, "Suspended by a platform administrator")) : x)))
    setAudit((all) => [
      auditEntry(all, at, actor, suspended ? "tenant.reactivated" : "tenant.suspended", t.name, suspended ? "Reactivated by a platform administrator" : "Suspended by a platform administrator"),
      ...all,
    ])
    toast.success(`${t.name} ${suspended ? "reactivated" : "suspended"}`)
  }

  const billingDate = tenant.billing.renewsOn
    ? { label: "Renews", iso: tenant.billing.renewsOn }
    : tenant.billing.trialEndsOn
      ? { label: "Trial ends", iso: tenant.billing.trialEndsOn }
      : null

  return (
    <>
      <Link href="/platform" className="pf-back">← Tenants</Link>
      <PageHead
        title={tenant.name}
        subtitle={<span className="num">{tenant.subdomain}</span>}
        actions={
          <button type="button" className={`btn ${suspended ? "btn-primary" : "btn-danger"}`} onClick={() => setConfirming(true)}>
            <Icon name="lock" />
            {suspended ? "Reactivate" : "Suspend"}
          </button>
        }
      />
      <div className="pf-grid">
        <div className="pf-col">
          <section className="card" aria-labelledby="pf-sub-h">
            <div className="card-head">
              <div>
                <h2 id="pf-sub-h">Subscription</h2>
                <div className="sub">Slug <span className="num">{tenant.slug}</span></div>
              </div>
              <StatusPill status={TENANT_STATUS[tenant.status]} />
            </div>
            <dl className="pf-meta">
              <div><dt>Plan</dt><dd>{plan?.name ?? tenant.plan}</dd></div>
              <div><dt>Price</dt><dd className="num">{plan ? `${money(plan.priceMonthly, currency)} / month` : "—"}</dd></div>
              <div><dt>MRR</dt><dd className="num">{mrr ? money(mrr, currency) : "—"}</dd></div>
              <div><dt>Created</dt><dd className="num">{dateY(tenant.createdAt)}</dd></div>
              {billingDate && <div><dt>{billingDate.label}</dt><dd className="num">{dateY(billingDate.iso)} {tzLabel}</dd></div>}
              {tenant.suspendedAt && <div><dt>Suspended</dt><dd className="num">{dateY(tenant.suspendedAt)} {tzLabel}</dd></div>}
            </dl>
            {tenant.suspendReason && <p className="pf-note">{tenant.suspendReason}. The workspace is read-only for its users.</p>}
          </section>

          <section className="card" aria-labelledby="pf-use-h">
            <div className="card-head">
              <div>
                <h2 id="pf-use-h">Usage against limits</h2>
                <div className="sub">{plan ? `${plan.name} plan` : "No plan"}</div>
              </div>
            </div>
            <ul className="pf-meters">
              {LIMITS.map((l) => {
                const used = tenant[l.used]
                const limit = plan?.limits[l.key]
                const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
                const over = limit !== undefined && used > limit
                const near = !over && pct >= 90
                return (
                  <li key={l.key}>
                    <div className="pf-meter-top">
                      <span>{l.label}</span>
                      <span className="num">
                        {num(used)} / {limit !== undefined ? num(limit) : "—"}{l.unit && ` ${l.unit}`}
                        {over ? " · over limit" : near ? " · near limit" : ""}
                      </span>
                    </div>
                    <div className="pf-meter" data-state={over ? "over" : near ? "near" : undefined} role="img" aria-label={`${l.label}: ${pct}% of limit used`}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <div className="pf-col">
          <section className="card pf-hidden" aria-labelledby="pf-hid-h">
            <span className="pf-hidden-ico" aria-hidden="true"><Icon name="lock" /></span>
            <h2 id="pf-hid-h">Operational data hidden</h2>
            <p>Operational data hidden: requires tenant-granted support access</p>
            <p className="pf-muted">Tasks, reports, staff and files stay private to {tenant.name} until their admin grants a time-limited support session. Every session is audited.</p>
            <Link href="/platform/support" className="btn btn-outline">
              <Icon name="help" />
              Support access
            </Link>
          </section>

          <section className="card" aria-labelledby="pf-con-h">
            <div className="card-head"><h2 id="pf-con-h">Contacts</h2></div>
            <ul className="pf-contacts">
              {tenant.contacts.map((c) => (
                <li key={c.role}>
                  <span className="pf-role">{c.role}</span>
                  <span className="tt">{c.name}</span>
                  <a href={`mailto:${c.email}`} className="pf-mail">{c.email}</a>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="pf-bill-h">
            <div className="card-head"><h2 id="pf-bill-h">Billing status</h2></div>
            <dl className="pf-meta pf-meta-1">
              <div><dt>Payment method</dt><dd>{tenant.billing.paymentMethod}</dd></div>
              <div>
                <dt>Last invoice</dt>
                <dd className="num">
                  {tenant.billing.lastInvoice
                    ? `${tenant.billing.lastInvoice.id} · ${dateY(tenant.billing.lastInvoice.at)} · ${tenant.billing.lastInvoice.paid ? "Paid" : "Payment failed"}`
                    : "No invoices yet"}
                </dd>
              </div>
              {tenant.billing.graceEndsOn && <div><dt>Grace period ends</dt><dd className="num">{dateY(tenant.billing.graceEndsOn)} {tzLabel}</dd></div>}
            </dl>
          </section>
        </div>
      </div>

      <SlugConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={suspended ? `Reactivate ${tenant.name}?` : `Suspend ${tenant.name}?`}
        text={
          suspended
            ? `${tenant.name} gets full write access again. This is recorded in the platform audit trail at ${stamp}.`
            : `Everyone at ${tenant.name} keeps read-only access until you reactivate it. This is recorded in the platform audit trail at ${stamp}.`
        }
        slug={tenant.slug}
        confirmLabel={suspended ? "Reactivate" : "Suspend"}
        destructive={!suspended}
        onConfirm={toggle}
      />
    </>
  )
}
