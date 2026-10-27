import { Sk, SkGroup } from "@/components/sk"

// One skeleton per dashboard widget. Each mirrors its widget's markup, classes and item counts, and every
// `lh` is the real line-box height measured in the browser, so the skeleton and the loaded widget are the same size.
// When a widget's layout changes, update its skeleton here too.

function CardHead({ sub = true, action }: { sub?: boolean; action?: number }) {
  return (
    <div className="card-head">
      <div>
        <Sk w={190} h={18} lh={28} />
        {sub && <Sk w={240} h={11} lh={17} style={{ marginTop: 2 }} />}
      </div>
      {action && <Sk w={action} h={37} r="pill" />}
    </div>
  )
}

const St = ({ w = 84 }: { w?: number }) => <Sk w={w} h={29} r={8} />

export function PageHeaderSkeleton() {
  return (
    <div className="head">
      <div>
        <Sk w={220} h={32} r={10} lh={40} />
        <Sk w={300} h={14} lh={20} style={{ marginTop: 8 }} />
      </div>
      <div className="head-actions">
        <Sk w={133} h={48} r={14} />
        <Sk w={196} h={48} r={14} />
      </div>
    </div>
  )
}

export function SectionCardsSkeleton() {
  return (
    <section className="stats">
      {Array.from({ length: 4 }, (_, i) => (
        <article key={i} className="stat">
          <div className="stat-top">
            <Sk w="55%" h={14} lh={22} />
            <Sk w={38} h={38} r="circle" />
          </div>
          <Sk w={90} h={40} r={10} lh={46} style={{ marginTop: "auto" }} />
          <Sk w="70%" h={11} lh={17} />
        </article>
      ))}
    </section>
  )
}

export function TasksClosedSkeleton() {
  const heights = [62, 74, 88, 40, 32, 72, 56]
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <Sk w={140} h={18} lh={28} />
          <Sk w={260} h={11} lh={17} style={{ marginTop: 2 }} />
        </div>
        <div className="legend">
          <Sk w={70} h={11} lh={17} />
          <Sk w={100} h={11} lh={17} />
          <Sk w={56} h={11} lh={17} />
        </div>
      </div>
      <div className="rc-bars sk-bars">
        {heights.map((h, i) => (
          <div key={i}>
            <Sk w="100%" h={`${h}%`} r="pill" style={{ maxWidth: 72 }} />
            <Sk w={14} h={10} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DailyReportSkeleton() {
  return (
    <div className="card deadline">
      <Sk w={170} h={16} lh={25} style={{ marginBottom: 4 }} />
      <Sk w={190} h={26} r={8} lh={34} style={{ margin: "10px 0 2px" }} />
      <Sk w={150} h={11} lh={17} />
      <div className="countdown">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="sk-count">
            <Sk w={30} h={20} lh={32} />
            <Sk w={36} h={8} lh={20} />
          </div>
        ))}
      </div>
      {/* Row 1: two-line detail, no progress. Row 2: one-line detail + progress bar (matches daily-report.json). */}
      <div className="rep-row">
        <div style={{ flex: 1 }}>
          <Sk w={80} h={13} lh={19} />
          <Sk w="80%" h={10} lh={16} />
          <Sk w="55%" h={10} lh={16} />
        </div>
        <St w={90} />
      </div>
      <div className="rep-row">
        <div style={{ flex: 1 }}>
          <Sk w={80} h={13} lh={19} />
          <Sk w="70%" h={10} lh={16} />
          <Sk w="80%" h={6} r="pill" style={{ marginTop: 6 }} />
        </div>
        <St w={90} />
      </div>
      <Sk w="100%" h={46} r={14} style={{ marginTop: 12 }} />
    </div>
  )
}

export function ManagerAttentionSkeleton() {
  return (
    <div className="card">
      <CardHead action={129} />
      <div className="list">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="item">
            <Sk w={42} h={42} r={12} />
            <div>
              <Sk w="65%" h={13} lh={20} />
              <Sk w="85%" h={11} lh={17} style={{ marginTop: 2 }} />
            </div>
            <div className="r">
              <St />
              <Sk w={62} h={29} r={8} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TaskProgressSkeleton() {
  return (
    <div className="card">
      <div className="card-head">
        <Sk w={150} h={18} lh={28} />
      </div>
      <div className="gauge-wrap">
        <div className="rc-gauge sk-gauge">
          <span className="sk sk-arc" aria-hidden="true" />
          <div className="rc-gauge-text">
            <Sk w={70} h={28} r={8} lh={37} />
            <Sk w={90} h={10} lh={15} style={{ marginTop: 4 }} />
          </div>
        </div>
        <div className="gauge-legend">
          <Sk w={96} h={11} lh={17} />
          <Sk w={96} h={11} lh={17} />
          <Sk w={96} h={11} lh={17} />
        </div>
      </div>
    </div>
  )
}

export function TeamTasksSkeleton() {
  return (
    <div className="card">
      <CardHead action={130} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[70, 40, 36, 56, 32, 50].map((w, i) => (
                <th key={i}><Sk w={w} h={10} lh={16} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, i) => (
              <tr key={i}>
                <td>
                  <div className="pers">
                    <Sk w={34} h={34} r="circle" />
                    <div>
                      <Sk w={96} h={12} lh={19} />
                      <Sk w={70} h={10} lh={16} />
                    </div>
                  </div>
                </td>
                <td>
                  <Sk w={150} h={12} lh={19} />
                  <Sk w={64} h={10} lh={16} />
                </td>
                <td><Sk w={58} h={19} r={6} /></td>
                <td><Sk w={16} h={12} r={2} /></td>
                <td><Sk w={60} h={12} /></td>
                <td><St /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CoverageFilesSkeleton() {
  return (
    <div className="card">
      <CardHead />
      <div className="cov">
        {/* First coverage detail wraps to two lines in coverage.json; the rest are one line. */}
        {[2, 1, 1].map((lines, i) => (
          <div key={i} className="cov-row">
            <Sk w={36} h={28} r={8} lh={38} style={{ margin: "0 4px" }} />
            <div className="tx" style={{ flex: 1 }}>
              <Sk w="70%" h={12} lh={19} />
              {Array.from({ length: lines }, (_, j) => (
                <Sk key={j} w={j ? "50%" : "90%"} h={10} lh={lines === 2 ? 20.5 : 20} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Sk w={150} h={11} lh={17} style={{ marginTop: 16, marginBottom: 2 }} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="doc">
          <div style={{ flex: 1 }}>
            <Sk w="60%" h={12} lh={19} />
            <Sk w="40%" h={10} lh={16} />
          </div>
          <St w={70} />
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <SkGroup label="Loading dashboard" className="sk-page">
      <PageHeaderSkeleton />
      <SectionCardsSkeleton />
      <section className="grid-2">
        <TasksClosedSkeleton />
        <DailyReportSkeleton />
      </section>
      <section className="grid-2">
        <ManagerAttentionSkeleton />
        <TaskProgressSkeleton />
      </section>
      <section className="grid-2">
        <TeamTasksSkeleton />
        <CoverageFilesSkeleton />
      </section>
    </SkGroup>
  )
}
