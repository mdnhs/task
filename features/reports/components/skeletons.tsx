import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { REPORT_PAGE_SIZE } from "../filters"

// Mirrors ReportsView with the same classes and counts. Role-aware:
//  - staff: TodayReportCard (no board / queue), history without the owner filter and column
//  - manager: SubmissionBoard (one row per department), ReviewQueue only when `canReview`, history with owner filter/column
// Queue and history counts come from the seed (loading.tsx); the history count ignores the client-side department filter.
const CardHead = ({ title, sub, button }: { title: number; sub: number; button?: boolean }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={16} lh={28} />
      <Sk w={sub} h={10} lh={18} style={{ marginTop: 2 }} />
    </div>
    {button && <Sk w={112} h={46} r={14} />}
  </div>
)

export function ReportsSkeleton({
  staff = false,
  canReview = true,
  depts = 2,
  queue = 3,
  rows = 10,
}: {
  staff?: boolean
  canReview?: boolean
  depts?: number
  queue?: number
  rows?: number
}) {
  return (
    <SkGroup label="Loading daily reports" className="sk-page">
      <PageHeadSkeleton wrap actions={[112]} />
      {staff ? (
        <div className="rep-top rep-top-staff">
          <div className="card deadline rep-today">
            <Sk w={120} h={14} lh={26} />
            <Sk w={200} h={24} r={8} lh={34} style={{ marginTop: 10 }} />
            <Sk w={180} h={10} lh={18} />
            <div className="countdown">
              {[0, 1, 2].map((i) => (
                <div key={i}><Sk w={36} h={22} r={6} lh={33} style={{ margin: "0 auto" }} /><Sk w={36} h={8} lh={15} style={{ margin: "0 auto" }} /></div>
              ))}
            </div>
            <div className="rep-row">
              <div><Sk w={70} h={12} lh={20} /><Sk w={120} h={10} lh={16} /><Sk w={110} h={6} r={6} style={{ marginTop: 6 }} /></div>
              <Sk w={84} h={29.4} r={8} />
            </div>
            <Sk w="100%" h={46} r={14} style={{ marginTop: 12 }} />
          </div>
        </div>
      ) : (
        <div className={`rep-top${canReview ? "" : " rep-top-one"}`}>
          <section className="card rep-board">
            <CardHead title={170} sub={150} />
            <ul className="rep-rows">
              {Array.from({ length: depts }, (_, i) => (
                <li key={i} className="rep-row-item">
                  <Sk w={58} h={19} r={6} className="sk-dep" />
                  <div className="pers rep-owner">
                    <Sk w={34} h={34} r="circle" />
                    <div><Sk w={96} h={12} lh={19} /><Sk w={120} h={10} lh={16} /></div>
                  </div>
                  <Sk w={84} h={29.4} r={8} />
                </li>
              ))}
            </ul>
          </section>
          {canReview && (
            <section className="card rep-queue">
              <CardHead title={110} sub={110} />
              {queue === 0 ? (
                <div className="od-empty">
                  <Sk w={56} h={56} r="circle" />
                  <Sk w={150} h={16} lh={28} />
                  <Sk w={220} h={12} lh={21} />
                </div>
              ) : (
              <ul className="rep-rows">
                {Array.from({ length: queue }, (_, i) => (
                  <li key={i} className="rep-row-item rep-q-item">
                    <div className="rep-q-link">
                      <div className="rep-q-main"><Sk w={140} h={12} lh={19} /><Sk w={150} h={10} lh={16} /></div>
                      <Sk w={84} h={29.4} r={8} />
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </section>
          )}
        </div>
      )}
      <section className="card rep-history">
        <CardHead title={staff ? 150 : 140} sub={110} button />
        <div className="od-filters" style={{ marginBottom: 16 }}>
          <div className="rep-date"><Sk w="100%" h={44} r={14} /></div>
          <div className="rep-date"><Sk w="100%" h={44} r={14} /></div>
          {!staff && (
            <>
              <Sk w={140} h={40} r="pill" />
            </>
          )}
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable rep-table">
            <thead>
              <tr>
                {(staff ? [44, 36, 50, 60] : [44, 36, 44, 50, 60]).map((w, i) => (
                  <th key={i}><Sk w={w} h={10} lh={16} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pageRows(rows, REPORT_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Report"><Sk w={90} h={12} lh={18.84} /><Sk w={150} h={10} lh={15.94} /></td>
                  <td data-label="Dept"><Sk w={58} h={19} r={6} className="sk-dep" /></td>
                  {!staff && (
                    <td data-label="Owner">
                      <div className="pers">
                        <Sk w={34} h={34} r="circle" />
                        <div><Sk w={96} h={12} lh={18.84} /><Sk w={70} h={10} lh={15.94} /></div>
                      </div>
                    </td>
                  )}
                  <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                  <td data-label="Submitted"><Sk w={90} h={12} lh={18.8} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(rows, REPORT_PAGE_SIZE) && <PagerSkeleton rows={rows} size={REPORT_PAGE_SIZE} />}
      </section>
    </SkGroup>
  )
}

// Mirrors ReportForm (edit mode): back link, PageHead with two buttons, meta card (8 items), nil card, `sections`
// collapsed accordion rows (fixed 56px triggers) and the sticky progress aside. loading.tsx gets no params, so the
// "Needs attention" count is a typical value.
/**
 * `review` picks the read-only layout (manager-home roles are always in review mode): reviewers get the wider
 * "Return for correction" + "Accept" buttons, readers none, and a submitted report has no sections needing attention.
 */
export function ReportFormSkeleton({
  sections = 10,
  attention = 4,
  returned = false,
  review,
  prefill = false,
}: {
  sections?: number
  attention?: number
  returned?: boolean
  review?: "reviewer" | "reader"
  /** The "Fill from linked records" banner (a draft the owner can fill from suggestions). */
  prefill?: boolean
}) {
  return (
    <SkGroup label="Loading report" className="sk-page">
      <span className="td-back"><Sk w={110} h={12} lh={20} /></span>
      <div className="head">
        <div>
          <span className="sk-line rf-sk-h1"><Sk w={220} h="var(--sk-h1,32px)" r={10} /></span>
          <Sk w={300} h={14} lh={20} style={{ marginTop: 8 }} />
        </div>
        {review !== "reader" && (
          <div className="head-actions">
            <Sk w={review ? 186 : 120} h="var(--sk-btn-h,48px)" r={14} className={review ? "rf-sk-btn rf-sk-wide" : "rf-sk-btn"} />
            <Sk w={120} h="var(--sk-btn-h,48px)" r={14} className="rf-sk-btn" />
          </div>
        )}
      </div>
      {returned && (
        <div className="td-state warn">
          <Sk w={160} h={14} lh={22} />
          <Sk w="70%" h={12} lh={20} />
        </div>
      )}
      {prefill && !review && (
        <section className="card rf-prefill-bar">
          <p>
            <Sk w={170} h={14} lh={20} />
            <Sk w="90%" h={12} lh={20} />
          </p>
          <Sk w={120} h={48} r={14} className="rf-sk-btn" />
        </section>
      )}
      <div className="rf-grid">
        <div className="rf-col">
          <section className="card rf-meta">
            <dl className="td-meta">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i}>
                  <Sk w={64} h={10} lh={16} />
                  {i === 3 ? <Sk w={84} h={34} r={8} style={{ marginTop: 4 }} /> : <Sk w={110} h={12} lh={i >= 4 && i < 7 ? 23 : 22} style={{ marginTop: 4 }} />}
                </div>
              ))}
            </dl>
          </section>
          <section className="card rf-nil">
            <div>
              <Sk w={150} h={14} lh={24} />
              <Sk w={300} h={11} lh={20} />
              <Sk w={180} h={11} lh={20} className="rf-sk-wrap" />
            </div>
            <Sk w={32} h={18.4} r="pill" />
          </section>
          <div className="rf-secs">
            {Array.from({ length: sections }, (_, i) => (
              <div key={i} className="rf-sec" data-slot="accordion-item">
                <div className="rf-sec-trigger">
                  <Sk w={28} h={28} r="circle" />
                  <Sk w={150} h={13} lh={20} />
                  <span className="rf-sec-meta"><Sk w={44} h={29.4} r={8} /></span>
                </div>
              </div>
            ))}
          </div>
          {review && (
            <>
              <section className="card rf-versions">
                <Sk w={140} h={16} lh={24} style={{ marginBottom: 12 }} />
                <div className="td-muted"><Sk w={220} h={11} lh={21} /></div>
                <ol className="rf-ver-list">
                  <li>
                    <Sk w={36} h={28} r="pill" />
                    <span className="rf-ver-body"><Sk w={150} h={12} lh={20} /><Sk w={180} h={11} lh={21} /></span>
                  </li>
                </ol>
              </section>
              <section className="card rf-tools">
                {(review === "reviewer" ? [120, 120, 192] : [120, 120]).map((w, i) => (
                  <Sk key={i} w={w} h={48} r={14} />
                ))}
              </section>
            </>
          )}
        </div>
        <aside className="card rf-progress">
          <div className="rf-prog-head">
            <Sk w={44} h={16} lh={28} />
            <Sk w={90} h={11} lh={20} />
          </div>
          <Sk w="100%" h={6} r={6} style={{ marginTop: 6 }} />
          <div className="rf-attn">
            <Sk w={110} h={10} lh={20} />
            {review ? (
              <Sk w={170} h={11} lh={20} />
            ) : (
              <ul>
                {Array.from({ length: attention }, (_, i) => (
                  <li key={i}><Sk w={160} h={12} lh={32} /></li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </SkGroup>
  )
}
