import type { CoverageData } from "../types"

export function CoverageFiles({ data }: { data: CoverageData }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{data.subtitle}</div>
        </div>
      </div>
      <div className="cov">
        {data.coverage.map((c) => (
          <div key={c.title} className="cov-row">
            <span className={`n ${c.tone} num`}>{c.count}</span>
            <div className="tx"><b>{c.title}</b><small>{c.detail}</small></div>
          </div>
        ))}
      </div>
      <div className="sec-title" style={{ marginTop: 16 }}>Expiring documents</div>
      {data.expiringDocuments.map((d) => (
        <div key={d.title} className="doc">
          <div>{d.title}<small>{d.expires}</small></div>
          <span className={`st ${d.badge.tone}`}>{d.badge.label}</span>
        </div>
      ))}
    </div>
  )
}
