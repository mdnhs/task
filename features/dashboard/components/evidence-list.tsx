import Link from "next/link"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import type { StaffEvidenceData } from "../types"

export function EvidenceList({ data, today, tzLabel }: { data: StaffEvidenceData; today: string; tzLabel: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
      </div>
      <div className="list">
        {data.items.map((e) => (
          <Link key={e.ref} href={`/tasks/${e.ref}`} className="item item-link">
            <span className={`kind ${e.state === "returned" ? "amber" : "blue"}`}><Icon name="folder" /></span>
            <div>
              <div className="t">{e.title}</div>
              <div className="m">
                {e.state === "returned" ? (
                  <><b>{e.reviewer}</b> returned it: <span className="reason">{e.reason}</span></>
                ) : (
                  <>Sent <When iso={e.at} today={today} tzLabel={tzLabel} /> · with <b>{e.reviewer}</b></>
                )}
              </div>
            </div>
            <div className="r"><StatusPill status={e.status} /></div>
          </Link>
        ))}
      </div>
    </div>
  )
}
