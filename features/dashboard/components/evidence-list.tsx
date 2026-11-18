import Link from "next/link"

import { Icon } from "@/components/icons"
import type { StaffEvidenceData } from "../types"

// Evidence waiting for review (a count, the API gives no rows for it) and the items a reviewer returned, each with the reason.
export function EvidenceList({ data }: { data: StaffEvidenceData }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
      </div>
      <div className="list">
        {data.awaitingReview > 0 && (
          <Link href="/tasks?status=submitted" className="item item-link">
            <span className="kind blue"><Icon name="folder" /></span>
            <div>
              <div className="t">{data.awaitingReview} awaiting review</div>
              <div className="m">Sent for review and not yet approved</div>
            </div>
          </Link>
        )}
        {data.returned.map((e) => (
          <Link key={e.ref} href={`/tasks/${e.ref}`} className="item item-link">
            <span className="kind amber"><Icon name="folder" /></span>
            <div>
              <div className="t">{e.title}</div>
              <div className="m">Returned: <span className="reason">{e.reason}</span></div>
            </div>
            <div className="r"><span className="st warn">Returned</span></div>
          </Link>
        ))}
      </div>
    </div>
  )
}
