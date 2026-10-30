"use client"

import { useState } from "react"

import { DataPagination, useSlideDir } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import { showValue as show } from "../../audit"
import { STAFF_ROLE_LABEL } from "../../permissions"
import type { AuditTab, T360Head } from "../../tenant-360"
import { useLiveAudit, useLiveTenant, type T360Ctx } from "./live"

const PAGE = 8

// Audit tab: the platform audit log filtered to this tenant (logic.ts → filterAudit), with the D7 change and reason.
export function AuditTabView({ head, data, ctx }: { head: T360Head; data: AuditTab; ctx: T360Ctx }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const entries = useLiveAudit(data.entries, head.tenant)
  const [page, setPage] = useState(1)
  const paged = paginate(entries, page, PAGE)
  const dir = useSlideDir(paged.page)
  return (
    <section className="card pf-card" aria-labelledby="pf-taud-h">
      <div className="card-head">
        <div>
          <h2 id="pf-taud-h">Audit trail</h2>
          <div className="sub">Every platform action on {t.name}: who, when, why and what changed</div>
        </div>
      </div>
      {entries.length ? (
        <>
          <ul key={paged.page} className="pf-audit od-slide" data-slide={dir}>
            {paged.rows.map((e) => (
              <li key={e.id}>
                <div className="pf-aud-main">
                  <span className="tt">{e.detail}</span>
                  <span className="pf-aud-act">{e.action}</span>
                </div>
                {e.before && e.after && Object.keys(e.after).length > 0 && (
                  <p className="pf-aud-change num">
                    {Object.keys(e.after).map((k) => (
                      <span key={k}>{k}: {show(e.before?.[k])} → {show(e.after?.[k])}</span>
                    ))}
                  </p>
                )}
                <div className="tm num">{e.actor}{e.staffRole ? ` (${STAFF_ROLE_LABEL[e.staffRole]})` : ""} · <When iso={e.at} today={ctx.today} tzLabel={ctx.tzLabel} /></div>
              </li>
            ))}
          </ul>
          <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Audit trail pages" onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon="shield" title="No platform actions yet" text={`Actions staff take on ${t.name} appear here.`} />
      )}
    </section>
  )
}
