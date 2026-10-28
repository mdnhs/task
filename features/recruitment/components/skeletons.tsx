import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup } from "@/components/sk"
import { STAGE_ORDER } from "../types"
import type { Stage } from "../types"

// Mirrors RecruitmentView on its default Pipeline view: PageHead, the five-card counts row, and the card with the filter
// bar and the stage columns (same classes). `counts` are the seed's candidates per stage, so column heights match.
export function RecruitmentSkeleton({ canWrite = true, counts }: { canWrite?: boolean; counts?: Partial<Record<Stage, number>> }) {
  return (
    <SkGroup label="Loading recruitment" className="sk-page">
      <PageHeadSkeleton actions={canWrite ? [170] : 0} />
      <section className="stats rec-stats">
        {Array.from({ length: 5 }, (_, i) => (
          <article key={i} className="stat">
            <div className="stat-top">
              <Sk w="55%" h={14} lh={22} />
              <Sk w={38} h={38} r="circle" />
            </div>
            <Sk w={60} h={40} r={10} lh={46} className="sk-val" style={{ marginTop: "auto" }} />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card rec-card-wrap">
        <div className="od-filters">
          <Sk w={138} h={50} r="pill" />
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="rec-board">
          {STAGE_ORDER.map((s, i) => {
            const n = counts?.[s] ?? 3
            return (
              <section key={s} className="rec-col">
                <header className="rec-col-head">
                  <Sk w={64 + (i % 3) * 8} h={14} lh={24} />
                  <Sk w={24} h={24} r="pill" />
                </header>
                <ul className="rec-col-body">
                  {n === 0 && <li className="rec-col-empty"><Sk w={96} h={12} lh={19} /></li>}
                  {Array.from({ length: n }, (_, k) => (
                    <li key={k}>
                      <div className="rec-card">
                        <Sk w="62%" h={13} lh={20} />
                        <Sk w="80%" h={11} lh={18} />
                        <Sk w="88%" h={11} lh={18} />
                        <div className="rec-card-foot">
                          <Sk w={80} h={11} lh={17} />
                          <Sk w={56} h={11} lh={17} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </SkGroup>
  )
}
