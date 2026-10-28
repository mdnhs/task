"use client"


import { PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { INCIDENT_STATUS, INCIDENT_TYPE } from "../types"
import type { Incident } from "../types"

export function AttendanceList({ rows, page, today, tzLabel, onOpen }: { rows: Incident[]; page: number; today: string; tzLabel: string; onOpen(id: string): void }) {
  return (
    <div className="table-wrap">
      <table className="rtable sr-table">
        <thead>
          <tr><th>Incident</th><th>Staff</th><th>Site</th><th>Cover</th><th>Owner</th><th>Status</th></tr>
        </thead>
        <PagedBody page={page}>
            {rows.map((i) => (
              <tr key={i.id}>
                <td data-label="Incident">
                  <button type="button" className="tt sr-link" onClick={() => onOpen(i.id)}>
                    {INCIDENT_TYPE[i.type]}
                    <span className="sr-shift"> · {i.shift}</span>
                  </button>
                  <div className="tm num">{i.id} · <When iso={i.reportedAt} today={today} tzLabel={tzLabel} /></div>
                </td>
                <td data-label="Staff">
                  <div className="tt">{i.staff}</div>
                  <div className="tm">{i.dept}</div>
                </td>
                <td data-label="Site">
                  <div className="tt">{i.site}</div>
                  <div className="tm">{i.client}</div>
                </td>
                <td data-label="Cover">{i.cover ?? <span className="sr-none">{i.type === "staff_issue" ? "Not needed" : "No cover yet"}</span>}</td>
                <td data-label="Owner">{i.owner}</td>
                <td data-label="Status"><StatusPill status={INCIDENT_STATUS[i.status]} /></td>
              </tr>
            ))}
        </PagedBody>
      </table>
    </div>
  )
}
