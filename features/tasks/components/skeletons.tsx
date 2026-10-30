import { When } from "@/components/when"
import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { TASKS_PAGE_SIZE } from "../filters"

// Mirrors TasksView: PageHead, .card.tasks-card with the filter bar and the .rtable rows (same classes, same counts).
// Rows are capped at the page size, with a pager row when the seed has more. `staff` drops the assignee filter (staff only see their own tasks); `canCreate` adds the New task button.
export function TasksSkeleton({ canCreate = true, staff = false, rows = 8, projects = true, labels = [], today = "", tzLabel = "" }: { canCreate?: boolean; staff?: boolean; rows?: number; projects?: boolean; today?: string; tzLabel?: string; labels?: { status: string; ev?: string; badge?: boolean; title?: string; meta?: string; badges?: string[]; assignee?: { name: string; more: number; role: string }; dept?: string; due?: string; late?: boolean; priority?: number }[] }) {
  return (
    <SkGroup label="Loading tasks" className="sk-page">
      <PageHeadSkeleton actions={canCreate ? [132] : 0} />
      <TabsSkeleton />
      <div className="card tasks-card">
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={39.6} r="pill" />
          <Sk w={140} h={39.6} r="pill" />
          <Sk w={140} h={39.6} r="pill" />
          {projects && <Sk w={140} h={39.6} r="pill" />}
          {!staff && (
            <>
              <Sk w={140} h={39.6} r="pill" />
            </>
          )}
          <Sk w={331} h={50} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable tasks-table">
            <thead>
              <tr>
                {[40, 64, 36, 56, 32, 50].map((w, i) => (
                  <th key={i}>{labels.length ? <span className="sk-ghost">{["Task", "Assignee", "Dept", "Priority", "Due", "Status"][i]}</span> : <Sk w={w} h={10} lh={16} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: pageRows(rows, TASKS_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Task">
                    {labels[i]?.title ? (
                      <>
                        <div className="tt"><span className="sk-ghost">{labels[i].title}</span></div>
                        <div className="tm num"><span className="sk-ghost">{labels[i].meta}</span>{labels[i].badges?.map((b) => <span key={b} className={`rp-badge sk-ghost${b.startsWith("\u2611") ? " num" : ""}`}>{b.startsWith("\u21bb") ? <><span aria-hidden="true">{"\u21bb "}</span>{b.slice(2)}</> : b}</span>)}</div>
                      </>
                    ) : (
                      <>
                        <Sk w={170} h={12} lh={18.84} className="sk-2l" />
                        <Sk w={64} h={10} lh={15.94} className="sk-2s" />
                      </>
                    )}
                  </td>
                  <td data-label="Assignee">
                    {labels[i]?.assignee ? (
                      <div className="pers">
                        <Sk w={34} h={34} r="circle" />
                        <div>
                          <div className="tt"><span className="sk-ghost">{labels[i].assignee.name}{labels[i].assignee.more > 0 && ` +${labels[i].assignee.more}`}</span></div>
                          <div className="tm"><span className="sk-ghost">{labels[i].assignee.role}</span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="pers">
                        <Sk w={34} h={34} r="circle" />
                        <div>
                          <Sk w={96} h={12} lh={18.84} />
                          <Sk w={70} h={10} lh={15.94} />
                        </div>
                      </div>
                    )}
                  </td>
                  <td data-label="Dept">{labels[i]?.dept ? <span className="dep-tag sk-ghost">{labels[i].dept}</span> : <Sk w={58} h={19} r={6} className="sk-dep" />}</td>
                  <td data-label="Priority">{labels[i]?.priority ? <span className={`prio p${labels[i].priority}`} aria-hidden="true"><i /><i /><i /></span> : <Sk w={16} h={12} r={2} />}</td>
                  <td data-label="Due" className={labels[i]?.due ? "num due" : undefined}>
                    {labels[i]?.due ? <span className="sk-ghost"><When iso={labels[i].due!} today={today} tzLabel={tzLabel} />{labels[i].late ? " · late" : ""}</span> : <Sk w={90} h={12} lh={18.8} />}
                  </td>
                  <td data-label="Status">
                    {/* Real pill + evidence tag markup with the real labels as ghost text: they flow on one line exactly like the loaded cell. */}
                    {labels[i] ? <><span className="st sk-ghost">{labels[i].status}</span>{labels[i].ev && <div className="ev-tag sk-ghost">{labels[i].ev}</div>}</> : <Sk w={84} h={29.4} r={8} />}
                  </td>
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
                    <div className="ev-review"><Sk w={70} h={32} r={14} /><Sk w={70} h={32} r={14} /></div>
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
                <Sk w={60} h={12} lh={18} />
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
            {/* Manager tools (Reschedule, Reassign, Remove) or the member's "Propose new dates" (task-actions.tsx) */}
            {canEdit && (
              <div className="td-deadline">
                {reviewer ? <div className="td-btns"><Sk w={120} h={46} r={14} /><Sk w={106} h={46} r={14} /><Sk w={98} h={46} r={14} /></div> : <Sk w={170} h={46} r={14} />}
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

/** The List / Board / Calendar / Projects / Archive tabs (task-view-tabs.tsx): 5 pill links in a .seg. */
export function TabsSkeleton() {
  return (
    <div className="seg od-seg tv-tabs" aria-hidden="true">
      {[62, 74, 92, 86, 82].map((w, i) => (
        <span key={i} className="tv-tab"><Sk w={w - 32} h={12} lh={18} /></span>
      ))}
    </div>
  )
}

/** Board filter bar (task-board.tsx BoardFilters): search, project, assignee (not for staff), plus extra controls. */
function BoardFiltersSkeleton({ staff, projects = true, seg }: { staff: boolean; projects?: boolean; seg?: number }) {
  return (
    <div className="od-filters">
      <Sk h={40} r="pill" className="sk-fsearch" />
      {projects && <Sk w={140} h={40} r="pill" />}
      {!staff && <Sk w={140} h={40} r="pill" />}
      {seg && <Sk w={seg} h={50} r="pill" />}
    </div>
  )
}

// Mirrors TaskBoard: six .kb-col columns with the real card count per status (from the seed). `movable` adds the "Move to" select.
/** One board card as the skeleton draws it: the real title/label text becomes ghost text so wrapping matches. */
export type BoardCardSk = { title: string; ev?: string; chip?: string; more?: number; move: boolean }

// Mirrors TaskBoard: columns of `.kb-card`s. `cards` carries the real card text per column; without it `counts` draws plain blocks.
export function TaskBoardSkeleton({ staff = false, counts = [3, 3, 2, 2, 2, 3], cards, movable = true, projects = true }: { staff?: boolean; counts?: number[]; cards?: BoardCardSk[][]; movable?: boolean; projects?: boolean }) {
  const cols = cards ?? counts.map((n) => Array.from({ length: n }, (): BoardCardSk | null => null))
  return (
    <SkGroup label="Loading board" className="sk-page">
      <PageHeadSkeleton sub={170} />
      <TabsSkeleton />
      <div className="card tasks-card">
        <BoardFiltersSkeleton staff={staff} projects={projects} />
        <div className="kb-scroll">
          <div className="kb-cols">
            {cols.map((list, c) => (
              <section key={c} className="kb-col">
                <header className="kb-head"><Sk w={8} h={8} r="circle" /><span className="kb-name"><Sk w={90} h={12} lh={20} /></span><Sk w={14} h={12} lh={20} /></header>
                <ul className="kb-list">
                  {list.map((k, i) => (
                    <li key={i} className="kb-card">
                      {k ? <span className="kb-title sk-ghost">{k.title}</span> : <Sk w="85%" h={13} lh={20} />}
                      <div className="kb-meta"><Sk w={60} h={10} lh={18} /><Sk w={50} h={10} lh={18} /></div>
                      <div className="kb-foot">
                        <Sk w={24} h={24} r="circle" />
                        {!!k?.more && <span className="kb-more num sk-ghost">+{k.more}</span>}
                        <Sk w={16} h={12} r={2} />
                        {k?.chip && <span className="kb-chip num sk-ghost">{k.chip}</span>}
                        {k?.ev && <span className="ev-tag sk-ghost">{k.ev}</span>}
                      </div>
                      {(k ? k.move : movable) && <Sk w="100%" h={34} r="pill" />}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </SkGroup>
  )
}

/** One month-grid cell: the day number and the chip texts the month view shows (MONTH_CHIPS), as ghost text. */
export type CalCellSk = { day: number; chips: string[]; more: number; total: number }

export function TaskCalendarSkeleton({ staff = false, projects = true, weeks }: { staff?: boolean; projects?: boolean; weeks?: CalCellSk[][] }) {
  const grid = weeks ?? Array.from({ length: 6 }, () => Array.from({ length: 7 }, (): CalCellSk | null => null))
  return (
    <SkGroup label="Loading calendar" className="sk-page">
      <PageHeadSkeleton sub={150} />
      <TabsSkeleton />
      <div className="card tasks-card">
        <BoardFiltersSkeleton staff={staff} projects={projects} seg={170} />
        <div className="cal-nav"><Sk w={52} h={38} r="pill" /><Sk w={74} h={38} r="pill" /><Sk w={52} h={38} r="pill" /><span className="cal-title"><Sk w={130} h={14} lh={24} /></span></div>
        <div className="cal-month">
          <div className="cal-row cal-dow">{Array.from({ length: 7 }, (_, i) => <div key={i}><Sk w={26} h={10} lh={16} /></div>)}</div>
          {grid.map((week, w) => (
            <div key={w} className="cal-row">
              {week.map((c, d) => (
                <div key={d} className="cal-cell">
                  {c ? <span className="cal-day num sk-ghost">{c.day}</span> : <Sk w={14} h={11} lh={18} />}
                  {c?.chips.map((t, i) => <span key={i} className="cal-chip sk-ghost">{t}</span>)}
                  {!!c?.more && <span className="cal-more sk-ghost">+{c.more} more</span>}
                  {!!c?.total && <span className="cal-dots sk-ghost" aria-hidden="true">{c.total}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkGroup>
  )
}

// Mirrors TaskProjects: one .pj-card per project with its milestone rows.
export function TaskProjectsSkeleton({ milestones = [2, 2], descriptions = [] }: { milestones?: number[]; descriptions?: string[] }) {
  return (
    <SkGroup label="Loading projects" className="sk-page">
      <PageHeadSkeleton sub={90} />
      <TabsSkeleton />
      <div className="pj-grid">
        {milestones.map((n, i) => (
          <section key={i} className="card pj-card">
            <div className="card-head">
              <div><Sk w={180} h={14} lh={24} /><Sk w={220} h={10} lh={19.4} /></div>
              <Sk w={70} h={12} lh={18.8} />
            </div>
            {descriptions[i] ? <p className="pj-desc"><span className="sk-ghost">{descriptions[i]}</span></p> : <div className="pj-desc"><Sk w="95%" h={12} lh={21} /></div>}
            <div className="pj-prog"><Sk w={170} h={11} lh={20} /><Sk w="100%" h={6} r={6} /></div>
            <ol className="pj-ms">
              {Array.from({ length: n }, (_, j) => (
                <li key={j}><Sk w={10} h={10} r="circle" /><div className="pj-ms-body"><Line w={150} h={12} lh={20} /><Line w={110} h={10} lh={18} /></div><Sk w={56} h={29.4} r={8} /></li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </SkGroup>
  )
}

// Mirrors TaskArchive: the .rtable with one row per restorable archived task (or the empty state).
export function TaskArchiveSkeleton({ rows = 1, actions = true, tasks = [] }: { rows?: number; actions?: boolean; tasks?: { ref: string; title: string }[] }) {
  return (
    <SkGroup label="Loading archive" className="sk-page">
      <PageHeadSkeleton sub={190} />
      <TabsSkeleton />
      <div className="card tasks-card">
        {rows === 0 ? (
          <div className="od-empty"><span className="od-empty-ico"><Sk w={24} h={24} r={6} /></span><Sk w={180} h={14} lh={24} /><Sk w={280} h={11} lh={20} /></div>
        ) : (
          <div className="table-wrap">
            <table className="rtable tasks-table">
              <thead><tr>{[40, 46, 64, 70, 0].map((w, i) => <th key={i}>{w > 0 && <Sk w={w} h={10} lh={16} />}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    <td data-label="Task">
                      {tasks[i] ? <><div className="tt"><span className="sk-ghost">{tasks[i].title}</span></div><div className="tm num"><span className="sk-ghost">{tasks[i].ref}</span></div></> : <><Sk w={170} h={12} lh={18.84} className="sk-2l" /><Sk w={64} h={10} lh={15.94} className="sk-2s" /></>}
                    </td>
                    <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                    <td data-label="Removed"><Sk w={150} h={12} lh={18.8} /></td>
                    <td data-label="Restorable"><Sk w={80} h={12} lh={18.8} /></td>
                    <td data-label="Actions">{actions && <div className="ar-btns"><Sk w={80} h={32} r={14} /></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SkGroup>
  )
}
