import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup } from "@/components/sk"

// Mirrors AttentionView: PageHead, the decisions card (filter seg + .att-row items) and the outstanding card.
// Row text wraps in the real list, so rows use typical line counts; counts come from the seed (loading.tsx).
const CardHead = ({ title, sub }: { title: number; sub: number }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />
    </div>
  </div>
)

const Main = ({ ask }: { ask: number }) => (
  <div className="att-main">
    <span className="att-top">
      <Sk w={72} h={29.4} r={8} />
      <Sk w={260} h={14} lh={20} />
    </span>
    <Sk w="90%" h={12} lh={19} />
    <Sk w={ask} h={12} lh={19} />
  </div>
)

export function AttentionSkeleton({ items = 4, outstanding = 10, closed = 0, canWrite = true }: { items?: number; outstanding?: number; closed?: number; canWrite?: boolean }) {
  return (
    <SkGroup label="Loading manager attention" className="sk-page">
      <PageHeadSkeleton wrap />
      <section className="card att-card">
        <CardHead title={170} sub={130} />
        <div className="od-filters">
          <Sk w={201} h={50} r="pill" />
        </div>
        <ul className="att-list">
          {Array.from({ length: items }, (_, i) => (
            <li key={i}>
              <div className="att-row">
                <Main ask={320} />
                <div className="att-meta">
                  <Sk w={130} h={12} lh={19} />
                  <Sk w={110} h={12} lh={19} />
                  <Sk w={130} h={31} r={8} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card att-card att-out">
        <CardHead title={250} sub={190} />
        <ul className="att-list">
          {Array.from({ length: outstanding }, (_, i) => (
            <li key={i} className="att-out-row">
              <Main ask={300} />
              <div className="att-meta">
                <Sk w={110} h={12} lh={19} />
                <Sk w={90} h={12} lh={19} />
                {canWrite && i < outstanding - closed && (
                  <span className="att-actions">
                    <Sk w={77} h={35} r={14} />
                    <Sk w={66} h={35} r={14} />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </SkGroup>
  )
}
