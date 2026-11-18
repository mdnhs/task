"use client"

import { useMemo, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg } from "@/components/filter-bar"
import { DataPagination, PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import { PEOPLE_PAGE_SIZE, PEOPLE_TABS, PERSON_STATUS, filterPeople, maskLast3, peopleCounts } from "../logic"
import type { WaPeopleTab } from "../logic"
import type { WaPerson } from "../types"

// "People": each person's WhatsApp status. Admins see who can be reached, never a full number (the last 3 digits only).
export function PeopleList({ people, today, tzLabel }: { people: WaPerson[]; today: string; tzLabel: string }) {
  const [tab, setTab] = useState<WaPeopleTab>("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const counts = useMemo(() => peopleCounts(people), [people])
  const rows = useMemo(() => filterPeople(people, tab, q), [people, tab, q])
  const paged = paginate(rows, page, PEOPLE_PAGE_SIZE)
  const filtered = tab !== "all" || q.trim() !== ""

  return (
    <>
      <FilterBar>
        <FilterSeg label="Filter people by WhatsApp status" value={tab} onChange={(v) => { setTab(v); setPage(1) }} options={PEOPLE_TABS.map((t) => ({ value: t.value, label: <>{t.label} <span className="num">{counts[t.value]}</span></> }))} />
        <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search people" />
      </FilterBar>
      {paged.rows.length > 0 ? (
        <div className="table-wrap">
          <table className="rtable set-table wa-people">
            <thead>
              <tr><th>Person</th><th>Scope</th><th>WhatsApp</th><th>Number</th><th>Last message</th></tr>
            </thead>
            <PagedBody page={paged.page}>
              {paged.rows.map((p) => (
                <tr key={p.id}>
                  <td data-label="Person"><span className="tt">{p.name}</span><span className="tm acc-hint">{p.role}</span></td>
                  <td data-label="Scope"><span className="wa-scope">{p.scope.label}</span></td>
                  <td data-label="WhatsApp"><StatusPill status={PERSON_STATUS[p.status]} tick={false} /></td>
                  <td data-label="Number" className="num">{maskLast3(p.phoneLast3)}</td>
                  <td data-label="Last message">{p.lastMessageAt ? <When iso={p.lastMessageAt} today={today} tzLabel={tzLabel} /> : <span className="tm">Never</span>}</td>
                </tr>
              ))}
            </PagedBody>
          </table>
        </div>
      ) : (
        <EmptyState icon="users" title={filtered ? "No people match" : "No people yet"} text={filtered ? "Try another status or search." : "People appear here once they are invited."} />
      )}
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="People pages" onPageChange={setPage} />
    </>
  )
}
