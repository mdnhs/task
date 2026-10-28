"use client"

import { useState } from "react"

import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { money, moduleLabel } from "../logic"
import { usePlatform } from "../store"
import { LIMITS } from "../types"
import type { Plan, PlatformSeed } from "../types"
import { PlanDialog } from "./plan-dialog"

const num = (n: number) => n.toLocaleString("en-GB")

export function PlansView({ seed, actor, today }: { seed: PlatformSeed; actor: string; today: string }) {
  const { plans, tenants } = usePlatform(seed)
  const [editing, setEditing] = useState<Plan | undefined>()
  const [open, setOpen] = useState(false)
  // Every module any plan offers, in first-seen order, so the dialog can switch any of them on.
  const allModules = [...new Set(plans.flatMap((p) => p.modules))]

  return (
    <>
      <PageHead title="Plans" subtitle="Limits and modules each plan gives its tenants" />
      <section className="pf-plans" aria-label="Plans">
        {plans.map((p) => {
          const count = tenants.filter((t) => t.plan === p.id).length
          return (
            <article key={p.id} className="card pf-plan">
              <div className="card-head">
                <div>
                  <h2>{p.name}</h2>
                  <div className="sub">{count} {count === 1 ? "tenant" : "tenants"} · {p.trialDays}-day trial</div>
                </div>
                <button type="button" className="btn btn-outline pf-edit" onClick={() => { setEditing(p); setOpen(true) }} aria-label={`Edit ${p.name} plan`}>
                  <Icon name="gear" />
                  Edit
                </button>
              </div>
              <p className="pf-price num"><b>{money(p.priceMonthly, p.currency)}</b> / month</p>
              <dl className="pf-limits">
                {LIMITS.map((l) => (
                  <div key={l.key}>
                    <dt>{l.label}</dt>
                    <dd className="num">{num(p.limits[l.key])}{l.unit && ` ${l.unit}`}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <h3 className="pf-sub-h">Modules</h3>
                <ul className="pf-chips">
                  {p.modules.map((m) => <li key={m} className="dep-tag">{moduleLabel(m)}</li>)}
                </ul>
              </div>
            </article>
          )
        })}
      </section>
      <PlanDialog plan={editing} modules={allModules} open={open} onOpenChange={setOpen} actor={actor} today={today} />
    </>
  )
}
