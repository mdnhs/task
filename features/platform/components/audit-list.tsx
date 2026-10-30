"use client"

import { useState } from "react"

import { DataPagination, useSlideDir } from "@/components/data-pagination"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import { AUDIT_PAGE_SIZE } from "../constants"
import type { SupportAuditLine } from "../support"

// FR-SAAS-10: audit lines in a card. Newest first, 5 per page inside the card. Takes only the fields it shows, so a
// slim view model (support.ts) can feed it.
export function AuditList({ entries, today, tzLabel, title, sub }: { entries: SupportAuditLine[]; today: string; tzLabel: string; title: string; sub: string }) {
  const [page, setPage] = useState(1)
  const paged = paginate(entries, page, AUDIT_PAGE_SIZE)
  const dir = useSlideDir(paged.page)
  return (
    <section className="card pf-card" aria-labelledby="pf-aud-h">
      <div className="card-head">
        <div>
          <h2 id="pf-aud-h">{title}</h2>
          <div className="sub">{sub}</div>
        </div>
      </div>
      <ul key={paged.page} className="pf-audit od-slide" data-slide={dir}>
        {paged.rows.map((e) => (
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
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Audit trail pages" onPageChange={setPage} />
    </section>
  )
}
