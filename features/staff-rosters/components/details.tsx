import { When } from "@/components/when"
import { COVERAGE, INCIDENT_STATUS, INCIDENT_TYPE, WHEN_LABEL } from "../types"
import type { HistoryEntry, Incident, RosterGap } from "../types"
import { Sensitive } from "./sensitive"

function History({ entries, today, tzLabel }: { entries: HistoryEntry[]; today: string; tzLabel: string }) {
  return (
    <section aria-labelledby="sr-hist-h">
      <h3 id="sr-hist-h" className="sr-sub">History</h3>
      <ol className="sr-history">
        {entries.map((h, n) => (
          <li key={`${h.at}-${n}`}>
            <strong>{h.action}</strong> · {h.by}
            <span className="sr-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
            {h.note && <span className="sr-note">{h.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function IncidentDetail({ incident: i, sensitive, today, tzLabel }: { incident: Incident; sensitive: boolean; today: string; tzLabel: string }) {
  return (
    <>
      <dl className="sr-dl">
        <div><dt>Type</dt><dd>{INCIDENT_TYPE[i.type]}</dd></div>
        <div><dt>Status</dt><dd>{INCIDENT_STATUS[i.status].label}</dd></div>
        <div><dt>Staff</dt><dd>{i.staff} · {i.dept}</dd></div>
        <div><dt>Shift</dt><dd>{i.shift}</dd></div>
        <div><dt>Site</dt><dd>{i.site} · {i.client}</dd></div>
        <div><dt>Cover</dt><dd>{i.cover ?? <span className="sr-none">No cover yet</span>}</dd></div>
        <div><dt>Owner</dt><dd>{i.owner}</dd></div>
        <div><dt>Next action</dt><dd>{i.action}</dd></div>
        <div><dt>Reported</dt><dd><When iso={i.reportedAt} today={today} tzLabel={tzLabel} /></dd></div>
        <div><dt>Contact</dt><dd><Sensitive value={i.contact} allowed={sensitive} /></dd></div>
        <div><dt>Notes</dt><dd><Sensitive value={i.notes} allowed={sensitive} /></dd></div>
      </dl>
      <History entries={i.history} today={today} tzLabel={tzLabel} />
    </>
  )
}

export function GapDetail({ gap: g, sensitive, today, tzLabel }: { gap: RosterGap; sensitive: boolean; today: string; tzLabel: string }) {
  return (
    <>
      <dl className="sr-dl">
        <div><dt>Coverage</dt><dd>{COVERAGE[g.coverage].label}</dd></div>
        <div><dt>When</dt><dd>{WHEN_LABEL[g.when]} · <When iso={g.shiftStart} today={today} tzLabel="" mode="date" /> {g.time} {tzLabel}</dd></div>
        <div><dt>Site</dt><dd>{g.site} · {g.client}</dd></div>
        <div><dt>Role</dt><dd>{g.role} · {g.dept}</dd></div>
        <div><dt>Assigned</dt><dd>{g.assigned || <span className="sr-none">Nobody assigned</span>}</dd></div>
        <div><dt>Owner</dt><dd>{g.owner}</dd></div>
        <div><dt>Next action</dt><dd>{g.nextAction}</dd></div>
        <div><dt>Notes</dt><dd><Sensitive value={g.notes} allowed={sensitive} /></dd></div>
      </dl>
      <History entries={g.history} today={today} tzLabel={tzLabel} />
    </>
  )
}
