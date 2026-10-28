"use client"

import { PagedBody } from "@/components/data-pagination"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { STAGE } from "../types"
import type { Candidate } from "../types"

export function CandidateTable({ rows, page, today, tzLabel, onOpen }: { rows: Candidate[]; page: number; today: string; tzLabel: string; onOpen(id: string): void }) {
  return (
    <div className="table-wrap">
      <table className="rtable rec-table">
        <thead>
          <tr><th>Candidate</th><th>Role</th><th>Dept</th><th>Stage</th><th>Owner</th><th>Last contact</th><th>Next action</th></tr>
        </thead>
        <PagedBody page={page}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td data-label="Candidate">
                <button type="button" className="rec-link tt" onClick={() => onOpen(c.id)}>{c.name}</button>
                <div className="tm num">{c.id}</div>
              </td>
              <td data-label="Role">{c.role}</td>
              <td data-label="Dept"><span className="dep-tag">{c.dept}</span></td>
              <td data-label="Stage"><StatusPill status={STAGE[c.stage]} /></td>
              <td data-label="Owner">{c.owner}</td>
              <td data-label="Last contact" className="num">{c.lastContact ? <When iso={c.lastContact} today={today} tzLabel={tzLabel} /> : "No contact yet"}</td>
              <td data-label="Next action" className="rec-next">{c.nextAction}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </div>
  )
}
