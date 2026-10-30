"use client"

import Link from "next/link"

import { CountUp } from "@/components/count-up"
import { EmptyState } from "@/components/empty-state"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { When } from "@/components/when"
import type { AttentionItem, AttentionKind } from "../attention"
import { PAGE_HEADS } from "../constants"
import { isCompacted } from "../money"
import { type ActivityLine, type DeltaTone, type OverviewData, type PlanMixRow } from "../overview"
import { MrrChart } from "./mrr-chart"

// The console overview at /platform (Task 3, D2). Everything is computed on the server (overview.ts → overviewData);
// this component only renders it. `skeleton` swaps the charts for plain blocks, for the SkMask loading state.

const TONE_CLASS: Record<DeltaTone, string> = { good: "up", bad: "down", flat: "pf-flat" }
const KIND: Record<AttentionKind, { icon: string; tone: string; label: string }> = {
  past_due: { icon: "wallet", tone: "red", label: "Payment past due" },
  trial_ending: { icon: "clock", tone: "blue", label: "Trial ending" },
  limit: { icon: "layers", tone: "amber", label: "Near plan limit" },
  support: { icon: "shield", tone: "blue", label: "Support access" },
  data_request: { icon: "download", tone: "amber", label: "Data request" },
}

type Props = { data: OverviewData; today: string; tzLabel: string; skeleton?: boolean }

export function OverviewDashboard({ data, today, tzLabel, skeleton = false }: Props) {
  const { title, subtitle } = PAGE_HEADS.overview
  return (
    <>
      <PageHead title={title} subtitle={`${data.revenue ? subtitle : "Tenant growth and what needs attention across the platform"} · ${data.monthLabel}`} />

      <section className={data.revenue ? "stats pf-kpis" : "stats pf-kpis pf-kpis-3"} aria-label="Platform numbers">
        {data.kpis.map((k, i) => (
          <article key={k.key} className="stat">
            <div className="stat-top">
              <div>
                <h3>{k.title}</h3>
                {k.sub && <div className="pf-kpi-sub">{k.sub}</div>}
              </div>
              {k.href && (
                <Link className="arrow" href={k.href} aria-label={`Open ${k.title}`}>
                  <Icon name="arrow" />
                </Link>
              )}
            </div>
            <div className="value num" title={k.exact}>
              {k.prefix && <small>{k.prefix}</small>}
              <CountUp value={k.value} delay={0.1 + i * 0.04} decimals />
              {k.suffix && <small>{k.suffix}</small>}
            </div>
            {/* A compacted amount (€12.4k) also shows its exact value, so it is readable without hover (D11). */}
            {isCompacted(k.suffix) && <div className="pf-exact num">{k.exact}</div>}
            <div className="note">
              <span className={TONE_CLASS[k.delta.tone]}>{k.delta.text}</span>
              {k.note}
            </div>
          </article>
        ))}
      </section>

      {data.revenue ? (
        <>
          <div className="pf-ov-grid">
            <MrrChart series={data.revenue.series} currency={data.revenue.currency} skeleton={skeleton} />
            <PlanMix rows={data.planMix} revenue />
          </div>
          <div className={data.activity ? "pf-ov-grid" : undefined}>
            <Attention items={data.attention} />
            {data.activity && <Activity lines={data.activity} today={today} tzLabel={tzLabel} />}
          </div>
        </>
      ) : (
        // No billing.read: no revenue in the payload. Attention leads; plan mix (by tenants) and activity stack beside it.
        <div className="pf-ov-grid">
          <Attention items={data.attention} />
          <div className="pf-ov-side">
            <PlanMix rows={data.planMix} revenue={false} />
            {data.activity && <Activity lines={data.activity} today={today} tzLabel={tzLabel} />}
          </div>
        </div>
      )}
    </>
  )
}

function PlanMix({ rows, revenue }: { rows: PlanMixRow[]; revenue: boolean }) {
  return (
    <section className="card pf-mix-card" aria-labelledby="pf-mix-h">
      <div className="card-head">
        <div>
          <h2 id="pf-mix-h">Plan mix</h2>
          <div className="sub">{revenue ? "Tenants and MRR by plan" : "Tenants by plan, suspended left out"}</div>
        </div>
      </div>
      <ul className="pf-mix">
        {rows.map((p) => (
          <li key={p.id}>
            <div className="pf-mix-top">
              <b>{p.name}</b>
              <span className="num">{p.total}</span>
            </div>
            <div className="pf-mix-sub num">
              {p.paying} paying{p.trials > 0 ? ` · ${p.trials} on trial` : ""}
              <span>{p.shareLabel}</span>
            </div>
            <div suppressHydrationWarning className="progress pf-mix-bar" role="img" aria-label={`${p.name}: ${p.shareLabel}`}>
              <i style={{ width: `${p.share}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <section className="card" aria-labelledby="pf-att-h">
      <div className="card-head">
        <div>
          <h2 id="pf-att-h">Needs attention</h2>
          <div className="sub">{items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}, late payments first` : "Nothing waiting"}</div>
        </div>
      </div>
      {items.length ? (
        <ul className="pf-att">
          {items.map((a) => {
            const k = KIND[a.kind]
            return (
              <li key={a.id}>
                <Link href={a.href} className="pf-att-row">
                  <span className={`kind ${k.tone}`} aria-hidden="true"><Icon name={k.icon} /></span>
                  <span className="pf-att-main">
                    <span className="pf-att-t">{a.tenant}</span>
                    <span className="pf-att-m"><span className="sr-only">{k.label}: </span>{a.detail}</span>
                  </span>
                  {a.when && <span className="pf-att-when num">{a.when}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState icon="flag" title="All clear" text="No overdue payments, ending trials, full plans or open requests." />
      )}
    </section>
  )
}

function Activity({ lines, today, tzLabel }: { lines: ActivityLine[]; today: string; tzLabel: string }) {
  return (
    <section className="card pf-card" aria-labelledby="pf-act-h">
      <div className="card-head">
        <div>
          <h2 id="pf-act-h">Recent activity</h2>
          <div className="sub">The last {lines.length} platform actions</div>
        </div>
        <Link className="pill-btn" href="/platform/audit">View audit log</Link>
      </div>
      <ul className="pf-audit pf-recent">
        {lines.map((e) => (
          <li key={e.id}>
            <div className="pf-aud-main">
              <span className="tt">{e.target}</span>
              <span className="pf-aud-act">{e.action}</span>
            </div>
            <p>{e.detail}</p>
            <div className="tm num">{e.actor} · <When iso={e.at} today={today} tzLabel={tzLabel} /></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
