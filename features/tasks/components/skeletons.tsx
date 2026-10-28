import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { TASKS_PAGE_SIZE } from "../filters"

// Mirrors TasksView: PageHead, .card.tasks-card with the filter bar and the .rtable rows (same classes, same counts).
// Rows are capped at the page size, with a pager row when the seed has more. `staff` drops the assignee filter (staff only see their own tasks); `canCreate` adds the New task button.
export function TasksSkeleton({ canCreate = true, staff = false, rows = 8 }: { canCreate?: boolean; staff?: boolean; rows?: number }) {
  return (
    <SkGroup label="Loading tasks" className="sk-page">
      <PageHeadSkeleton actions={canCreate ? [132] : 0} />
      <div className="card tasks-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
          {!staff && (
            <>
              <Sk w={140} h={40} r="pill" />
            </>
          )}
          <Sk w={331} h={50} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable tasks-table">
            <thead>
              <tr>
                {[40, 64, 36, 56, 32, 50].map((w, i) => (
                  <th key={i}><Sk w={w} h={10} lh={16} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pageRows(rows, TASKS_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Task">
                    <Sk w={170} h={12} lh={18.84} className="sk-2l" />
                    <Sk w={64} h={10} lh={15.94} className="sk-2s" />
                  </td>
                  <td data-label="Assignee">
                    <div className="pers">
                      <Sk w={34} h={34} r="circle" />
                      <div>
                        <Sk w={96} h={12} lh={18.84} />
                        <Sk w={70} h={10} lh={15.94} />
                      </div>
                    </div>
                  </td>
                  <td data-label="Dept"><Sk w={58} h={19} r={6} className="sk-dep" /></td>
                  <td data-label="Priority"><Sk w={16} h={12} r={2} /></td>
                  <td data-label="Due"><Sk w={90} h={12} lh={18.8} /></td>
                  <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(rows, TASKS_PAGE_SIZE) && <PagerSkeleton rows={rows} size={TASKS_PAGE_SIZE} />}
      </div>
    </SkGroup>
  )
}

const Line = ({ w, h = 12, lh = 20 }: { w: number | string; h?: number; lh?: number }) => <Sk w={w} h={h} lh={lh} />

// Mirrors TaskDetail: back link, PageHead, then the .td-grid with the same cards (main, evidence, notes | actions, timeline).
// Row counts are typical (2 evidence items, 4 timeline entries); the real lists grow past them.
// `canEdit` (write access) shows the drop zone, add buttons and notes form; `reviewer` (manager home + write) adds the
// per-item review row and the deadline block. loading.tsx gets no route params (Next docs, loading.md), so it
// derives both from the session and cannot know the ref: counts stay typical.
export function TaskDetailSkeleton({ canEdit = true, reviewer = false }: { canEdit?: boolean; reviewer?: boolean }) {
  return (
    <SkGroup label="Loading task" className="sk-page">
      <span className="td-back"><Sk w={80} h={12} lh={20} /></span>
      <div className="head">
        <div>
          <Sk w={360} h={32} r={10} lh={40} />
          <Sk w={80} h={14} lh={20} style={{ marginTop: 8 }} />
        </div>
      </div>
      <div className="td-grid">
        <div className="td-col">
          <section className="card td-main">
            <div className="td-badges">
              <Sk w={110} h={29.4} r={8} />
              <Sk w={110} h={16} r={4} />
              <Sk w={64} h={29.4} r={8} />
            </div>
            <div className="td-desc"><Line w="92%" h={13} lh={23} /><Line w="60%" h={13} lh={23} /></div>
            <dl className="td-meta">
              {/* Assignee, Created by, Department, Start, Due, Client. The assignee's avatar makes its value 26px (browser-measured) */}
              {[96, 96, 70, 80, 110, 90].map((w, i) => (
                <div key={i}>
                  <Line w={56} h={10} lh={16} />
                  <div style={{ marginTop: 4 }}><Line w={w} h={12} lh={i === 0 ? 26 : 22} /></div>
                </div>
              ))}
            </dl>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <Line w={80} h={14} lh={24} />
                <Line w={220} h={10} lh={16} />
              </div>
            </div>
            {canEdit && (
              <>
                <Sk w="100%" h={90} r={14} />
                <div className="ev-add"><Sk w={104} h={46} r={14} /><Sk w={104} h={46} r={14} /></div>
              </>
            )}
            <ul className="ev-list">
              {[0, 1].map((i) => (
                <li key={i} className="ev-item">
                  <div className="ev-main"><Sk w={46} h={19} r={6} /><span className="ev-name"><Line w={120} h={12} lh={21} /></span><Sk w={104} h={29.4} r={8} /></div>
                  <Line w={170} h={10} lh={18} />
                  {reviewer && (
                    <div className="ev-review"><Sk w={70} h={32} r={14} /><Sk w={70} h={32} r={14} /><Sk w={96} h={32} r={14} /></div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <Line w={110} h={14} lh={24} />
            <div style={{ marginTop: 12 }}><Line w={120} h={11} lh={20} /></div>
            {canEdit && (
              <div className="td-form">
                <Sk w={110} h={12} lh={18} />
                <Sk w="100%" h={96} r={14} />
                <div className="td-form-foot"><Sk w={112} h={46} r={14} /></div>
              </div>
            )}
          </section>
        </div>
        <div className="td-col">
          <section className="card td-actions">
            <Line w={70} h={14} lh={24} />
            {canEdit && <div className="td-btns" style={{ marginTop: 12 }}><Sk w={150} h={46} r={14} /><Sk w={120} h={46} r={14} /></div>}
            {!canEdit && <div style={{ marginTop: 12 }}><Line w={200} h={11} lh={20} /></div>}
            {reviewer && (
              <div className="td-deadline">
                <div className="od-field"><Sk w={110} h={12} lh={18} /><Sk w="100%" h={44} r={14} /></div>
                <Sk w={140} h={46} r={14} />
              </div>
            )}
          </section>
          <section className="card">
            <Line w={80} h={14} lh={24} />
            <ol className="td-timeline" style={{ marginTop: 12 }}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i}>
                  <Sk w={10} h={10} r="circle" style={{ marginTop: 6, flex: "none" }} />
                  <div><Line w={220} h={12} lh={20} /><Line w={150} h={10} lh={18} /></div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </SkGroup>
  )
}
