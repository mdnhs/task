import { When } from "@/components/when"
import type { Report } from "../types"

// FR-REP-10: every submission is kept. The original submission time is v1's own `at` and is never rewritten by later versions.
export function VersionHistory({ report, today, tzLabel }: { report: Report; today: string; tzLabel: string }) {
  const versions = [...report.versions].sort((a, b) => b.v - a.v)
  const original = report.versions.find((v) => v.v === 1)?.at ?? report.submittedAt
  return (
    <section className="card rf-versions" aria-labelledby="rf-versions-h">
      <h2 className="td-h" id="rf-versions-h">Version history</h2>
      {original && (
        <p className="td-muted">
          Originally submitted <When iso={original} today={today} tzLabel={tzLabel} />
        </p>
      )}
      {versions.length === 0 ? (
        <p className="td-muted">No versions yet. A version is saved each time the report is submitted.</p>
      ) : (
        <ol className="rf-ver-list">
          {versions.map((v) => (
            <li key={v.v}>
              <span className="rf-ver-n">v{v.v}</span>
              <span className="rf-ver-body">
                <strong>{v.note}</strong>
                <span>
                  {v.by} · <When iso={v.at} today={today} tzLabel={tzLabel} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
