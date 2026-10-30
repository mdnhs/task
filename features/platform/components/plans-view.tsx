"use client"

import Link from "next/link"
import { useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { PLATFORM_LOCALE, PLAN_NEW_PATH, planEditPath } from "../constants"
import { archiveBlock, planStats, type PlansData } from "../plans"
import { nowIso, sensitiveEntry } from "../logic"
import { money } from "../money"
import { applyPatches } from "../patches"
import { SCOPE, auditOutbox, auditStore, entitlementsStore, plansStore, tenantsStore, usePatches, useOutbox } from "../store"
import { LIMITS } from "../types"
import type { Plan, StaffRole } from "../types"
import { SlugConfirmDialog } from "./slug-confirm-dialog"

const num = (n: number) => n.toLocaleString(PLATFORM_LOCALE)

export type Operator = { name: string; role: StaffRole }

// /platform/plans (Task 7): the plans side by side, limits and modules as rows. The server sends only what renders
// (plans.ts: no tenant names). Reads the shared plans/entitlements stores (seeded here with the same catalogue the full
// pages use), so an edit, a new plan or an archive made in this session shows at once; counts follow the tenants store.
export function PlansView({ data, today, operator }: { data: PlansData; today: string; operator: Operator }) {
  const [stored] = plansStore.useStore(data.plans, SCOPE)
  const [ent] = entitlementsStore.useStore(data.entitlements, SCOPE)
  const full = useSyncExternalStore(tenantsStore.subscribe, tenantsStore.get, () => undefined)
  const patches = usePatches()
  const outbox = useOutbox()
  const [target, setTarget] = useState<Plan | null>(null)

  // Active plans first (the file's order, cheapest first), archived ones at the end.
  const plans = useMemo(() => [...stored.filter((p) => !p.archived), ...stored.filter((p) => p.archived)], [stored])
  const tenants = useMemo(() => {
    const byId = new Map((full ?? []).map((t) => [t.id, t]))
    return applyPatches(data.tenants.map((t) => { const f = byId.get(t.id); return f ? { ...t, plan: f.plan, status: f.status } : t }), patches)
  }, [data.tenants, full, patches])
  const stats = useMemo(() => planStats(stored, tenants, data.can.amounts), [stored, tenants, data.can.amounts])
  const included = (id: string) => new Set(ent.plans[id] ?? [])

  function archive(reason: string) {
    const plan = target
    if (!plan || archiveBlock(plan, tenants, ent.defaultPlan)) return
    const at = nowIso(today)
    plansStore.set((all) => all.map((p) => (p.id === plan.id ? { ...p, archived: true } : p)))
    // The outbox is numbered against what this page knows; a full page folds it into the log (store.ts).
    const known = [...(auditStore.get() ?? []), ...outbox]
    auditOutbox.set((list) => [
      sensitiveEntry(known, {
        at, actor: operator.name, staffRole: operator.role, action: "plan.archived", target: plan.name,
        detail: `Archived the ${plan.name} plan: ${reason}`, before: { archived: false }, after: { archived: true }, reason,
      }),
      ...list,
    ])
    toast.success(`${plan.name} plan archived`)
  }

  return (
    <>
      <PageHead
        title="Plans"
        subtitle="Limits, modules and revenue of each plan, side by side"
        actions={data.can.write ? <Link href={PLAN_NEW_PATH} className="btn btn-primary"><Icon name="plus" />New plan</Link> : undefined}
      />
      <div className="card pf-cmp-card">
        <div className="pf-cmp-scroll" tabIndex={0} role="region" aria-label="Plan comparison">
          <table className="pf-cmp" style={{ "--cols": plans.length } as React.CSSProperties}>
            <thead>
              <tr>
                <th scope="col" className="pf-cmp-corner"><span className="sr-only">Feature</span></th>
                {plans.map((p) => {
                  const why = data.can.write && !p.archived ? archiveBlock(p, tenants, ent.defaultPlan) : null
                  return (
                    <th key={p.id} scope="col" data-archived={p.archived || undefined}>
                      <div className="pf-cmp-plan">
                      <span className="pf-cmp-name">{p.name}{p.archived && <span className="pf-cmp-tag">Archived</span>}</span>
                      <span className="pf-cmp-price num"><b>{money(p.priceMonthly, p.currency)}</b> / month</span>
                      {/* An archived plan is read only: no Edit, no Archive. */}
                      {data.can.write && !p.archived && (
                        <span className="pf-cmp-acts">
                          <Link href={planEditPath(p.id)} className="btn btn-outline pf-act" aria-label={`Edit ${p.name} plan`}>Edit</Link>
                          <button type="button" className="btn btn-outline pf-act" disabled={why !== null} aria-describedby={why ? `pf-why-${p.id}` : undefined} onClick={() => setTarget(p)}>
                            Archive
                          </button>
                          {why && <span id={`pf-why-${p.id}`} className="pf-cmp-why">{why}</span>}
                        </span>
                      )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Tenants</th>
                {plans.map((p) => <td key={p.id} className="num">{num(stats[p.id]?.tenants ?? 0)}</td>)}
              </tr>
              {data.can.amounts && (
                <tr>
                  <th scope="row">MRR</th>
                  {plans.map((p) => <td key={p.id} className="num">{money(stats[p.id]?.mrr ?? 0, p.currency)}</td>)}
                </tr>
              )}
              <tr>
                <th scope="row">Free trial</th>
                {plans.map((p) => <td key={p.id} className="num">{p.trialDays} days</td>)}
              </tr>
              <tr className="pf-cmp-sec"><th scope="rowgroup" colSpan={plans.length + 1}>Limits</th></tr>
              {LIMITS.map((l) => (
                <tr key={l.key}>
                  <th scope="row">{l.label}</th>
                  {plans.map((p) => <td key={p.id} className="num">{num(p.limits[l.key])}{l.unit && ` ${l.unit}`}</td>)}
                </tr>
              ))}
              <tr className="pf-cmp-sec"><th scope="rowgroup" colSpan={plans.length + 1}>Modules</th></tr>
              {ent.productModules.map((m) => (
                <tr key={m.id}>
                  <th scope="row">{m.label}</th>
                  {plans.map((p) => {
                    const on = included(p.id).has(m.id)
                    return (
                      <td key={p.id} className="pf-cmp-mod" data-on={on || undefined}>
                        <span aria-hidden="true">{on ? "✓" : "–"}</span>
                        <span className="sr-only">{on ? "Included" : "Not included"}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <SlugConfirmDialog
        open={target !== null}
        onOpenChange={(o) => { if (!o) setTarget(null) }}
        title={`Archive the ${target?.name ?? ""} plan?`}
        text="Archived plans can't be chosen for tenants. No tenant is on this plan, so nobody is affected."
        slug={target?.id ?? ""}
        reason
        destructive
        confirmLabel="Archive plan"
        onConfirm={(r) => { archive(r); setTarget(null) }}
      />
    </>
  )
}
