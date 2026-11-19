"use client"

import { useMemo, useState } from "react"

import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg } from "@/components/filter-bar"
import { DataPagination, PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { paginate } from "@/lib/paginate"
import { LOG_PAGE_SIZE, LOG_TABS, MESSAGE_STATUS, filterMessages, maskLast3 } from "../logic"
import type { WaMessage, WaMessageStatus } from "../types"

// "Message log": who was sent which template and what happened. Never a message body, and never more than the last 3 digits of a number.
export function MessageLog({ messages, today, tzLabel }: { messages: WaMessage[]; today: string; tzLabel: string }) {
  const [tab, setTab] = useState<"all" | WaMessageStatus>("all")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const rows = useMemo(() => filterMessages(messages, tab, q), [messages, tab, q])
  const paged = paginate(rows, page, LOG_PAGE_SIZE)
  const filtered = tab !== "all" || q.trim() !== ""

  return (
    <>
      <FilterBar>
        <FilterSeg label="Filter messages by status" value={tab} onChange={(v) => { setTab(v); setPage(1) }} options={LOG_TABS} />
        <FilterSearch value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search messages" />
      </FilterBar>
      {paged.rows.length > 0 ? (
        <div className="table-wrap">
          <table className="rtable set-table wa-log">
            <thead>
              <tr><th>Time</th><th>To</th><th>Template</th><th>Status</th></tr>
            </thead>
            <PagedBody page={paged.page}>
              {paged.rows.map((m) => (
                <tr key={m.id}>
                  <td data-label="Time" className="num"><When iso={m.at} today={today} tzLabel={tzLabel} /></td>
                  <td data-label="To"><span className="tt">{m.recipient}</span><span className="tm acc-hint num">{maskLast3(m.phoneLast3)}</span></td>
                  <td data-label="Template"><code className="wa-tpl">{m.template}</code></td>
                  <td data-label="Status">
                    <span className="wa-status-cell">
                      <StatusPill status={MESSAGE_STATUS[m.status]} tick={false} />
                      {m.reason && <span className="tm">{m.reason}</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </PagedBody>
          </table>
        </div>
      ) : (
        <EmptyState icon="bubble-chat" title={filtered ? "No messages match" : "No messages yet"} text={filtered ? "Try another status or search." : "Sent messages appear here."} />
      )}
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Message log pages" onPageChange={setPage} />
    </>
  )
}
