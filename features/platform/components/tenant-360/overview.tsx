"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { Icon } from "@/components/icons"
import { When } from "@/components/when"
import { Textarea } from "@/components/ui/textarea"
import { PLATFORM_LOCALE } from "../../constants"
import { NOTE_MAX, addNote, dateY, nowIso } from "../../logic"
import { money } from "../../money"
import { tenantPath, type OverviewTab, type PlanLite, type T360Head } from "../../tenant-360"
import type { PlatformTenant, TenantTab } from "../../types"
import { HEALTH_BAND } from "../tenant-table"
import { commitTenant, useLiveTenant, type T360Ctx } from "./live"
import { UsageChart, meterState } from "./usage-chart"

const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)
const paying = (t: PlatformTenant) => t.status === "active" || t.status === "past_due"

/** The next billing date line: renewal, trial end or nothing. */
export function billingDate(t: PlatformTenant): { label: string; iso: string } | null {
  if (t.billing.renewsOn) return { label: t.cancelAtPeriodEnd ? "Ends" : "Renews", iso: t.billing.renewsOn }
  if (t.billing.trialEndsOn) return { label: "Trial ends", iso: t.billing.trialEndsOn }
  return null
}

/** Subscription facts shared by the overview and billing tabs. Amounts only with billing.read. */
export function SubscriptionFacts({ t, plan, amounts, tzLabel }: { t: PlatformTenant; plan: PlanLite | undefined; amounts: boolean; tzLabel: string }) {
  const date = billingDate(t)
  const mrr = plan?.priceMonthly != null && paying(t) ? plan.priceMonthly : 0
  return (
    <dl className="pf-meta">
      <div><dt>Plan</dt><dd>{plan?.name ?? t.plan}</dd></div>
      {amounts && plan?.priceMonthly != null && <div><dt>Price</dt><dd className="num">{money(plan.priceMonthly, plan.currency)} / month</dd></div>}
      {amounts && <div><dt>MRR</dt><dd className="num">{mrr ? money(mrr, plan!.currency) : "—"}</dd></div>}
      {date && <div><dt>{date.label}</dt><dd className="num">{dateY(date.iso)} {tzLabel}</dd></div>}
      {t.billing.graceEndsOn && t.status === "past_due" && <div><dt>Grace period ends</dt><dd className="num">{dateY(t.billing.graceEndsOn)} {tzLabel}</dd></div>}
      <div><dt>Created</dt><dd className="num">{dateY(t.createdAt)}</dd></div>
      {t.suspendedAt && <div><dt>Suspended</dt><dd className="num">{dateY(t.suspendedAt)} {tzLabel}</dd></div>}
    </dl>
  )
}

export function OverviewTabView({ head, data, ctx, tabs }: { head: T360Head; data: OverviewTab; ctx: T360Ctx; tabs: TenantTab[] }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const plan = head.plans.find((p) => p.id === t.plan)
  const health = head.health[t.status]
  const [note, setNote] = useState("")
  const notes = [...(t.notes ?? [])].reverse()

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim()) return
    const after = addNote(t, note, nowIso(ctx.today), ctx.operator.name)
    commitTenant(ctx, t, after, { action: "tenant.note_added", detail: "Added an internal note" })
    setNote("")
    toast.success("Note added")
  }

  return (
    <div className="pf-grid">
      <div className="pf-col">
        <section className="card" aria-labelledby="pf-sub-h">
          <div className="card-head">
            <div>
              <h2 id="pf-sub-h">Subscription</h2>
              <div className="sub">{plan ? `${plan.name} plan` : "No plan"}</div>
            </div>
            {tabs.includes("billing") && <Link href={tenantPath(t.id, "billing")} className="pf-more-link">Billing<Icon name="arrow" /></Link>}
          </div>
          <SubscriptionFacts t={t} plan={plan} amounts={head.can.amounts} tzLabel={ctx.tzLabel} />
          {t.suspendReason && <p className="pf-note">Suspended: {t.suspendReason}. The workspace is read-only for its users.</p>}
          {t.deletionAt && <p className="pf-note">Deletion scheduled for {dateY(t.deletionAt)}. See Settings to cancel it.</p>}
          {t.cancelAtPeriodEnd && <p className="pf-note pf-note-warn">The subscription ends at the end of the current period instead of renewing.</p>}
        </section>

        <section className="card" aria-labelledby="pf-use-h">
          <div className="card-head">
            <div>
              <h2 id="pf-use-h">Usage against limits</h2>
              <div className="sub">Last 30 days · {plan ? `${plan.name} plan limits` : "No plan"}</div>
            </div>
            <Link href={tenantPath(t.id, "usage")} className="pf-more-link">Usage<Icon name="arrow" /></Link>
          </div>
          <ul className="pf-ucards">
            {data.metrics.map((m) => {
              const limit = plan?.limits[m.key]
              const state = meterState(m.used, limit)
              const unit = m.unit ? ` ${m.unit}` : ""
              return (
                <li key={m.key} className="pf-ucard" data-state={state}>
                  <div className="pf-ucard-top">
                    <span className="pf-ucard-l">{m.label}</span>
                    {state && <span className="pf-ucard-s">{state === "over" ? "Over limit" : "Near limit"}</span>}
                  </div>
                  <div className="pf-ucard-v num">
                    <b>{num(m.used)}</b> / {limit !== undefined ? num(limit) : "—"}{unit}
                  </div>
                  <UsageChart metric={m} limit={limit} variant="spark" />
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card" aria-labelledby="pf-notes-h">
          <div className="card-head">
            <div>
              <h2 id="pf-notes-h">Internal notes</h2>
              <div className="sub">Staff only. Never shown to {t.name}; every note is in the audit trail.</div>
            </div>
          </div>
          {head.can.notes && (
            <form className="pf-note-form" onSubmit={add} aria-label="Add an internal note">
              <label htmlFor="pf-note-new" className="sr-only">New internal note</label>
              <Textarea id="pf-note-new" value={note} rows={2} maxLength={NOTE_MAX} placeholder="Add a note for the team" onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="btn btn-outline" disabled={!note.trim()}>Add note</button>
            </form>
          )}
          {notes.length > 0 ? (
            <ul className="pf-notes">
              {notes.map((n) => (
                <li key={n.id}>
                  <p>{n.text}</p>
                  <div className="tm num">{n.by} · <When iso={n.at} today={ctx.today} tzLabel={ctx.tzLabel} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pf-empty-line">No notes yet.</p>
          )}
        </section>
      </div>

      <div className="pf-col">
        {health && (
          <section className="card" aria-labelledby="pf-health-h">
            <div className="card-head">
              <div>
                <h2 id="pf-health-h">Health</h2>
                <div className="sub">Payments, seats, usage trend and support</div>
              </div>
              <span className={`st ${HEALTH_BAND[health.band].tone}`}>{HEALTH_BAND[health.band].label}</span>
            </div>
            <div className="pf-hscore num"><b>{health.score}</b> / 100</div>
            {health.reasons.length ? (
              <ul className="pf-hreasons">{health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            ) : (
              <p className="pf-empty-line">No issues found.</p>
            )}
          </section>
        )}

        <section className="card pf-hidden" aria-labelledby="pf-hid-h">
          <span className="pf-hidden-ico" aria-hidden="true"><Icon name="lock" /></span>
          <h2 id="pf-hid-h">Operational data hidden</h2>
          <p>Operational data hidden: requires tenant-granted support access</p>
          <p className="pf-muted">Tasks, reports, staff and files stay private to {t.name} until their admin grants a time-limited support session. Every session is audited.</p>
          <Link href={tenantPath(t.id, "support")} className="btn btn-outline">
            <Icon name="help" />
            Support access
          </Link>
        </section>

        <section className="card" aria-labelledby="pf-con-h">
          <div className="card-head">
            <div>
              <h2 id="pf-con-h">Contacts</h2>
              <div className="sub">{num(t.users)} active users</div>
            </div>
          </div>
          <ul className="pf-contacts">
            {t.contacts.map((c) => (
              <li key={`${c.role}-${c.email}`}>
                <span className="pf-role">{c.role}</span>
                <span className="tt">{c.name}</span>
                <a href={`mailto:${c.email}`} className="pf-mail">{c.email}</a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
