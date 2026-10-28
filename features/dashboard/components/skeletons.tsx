import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { TEAM_TASKS_PAGE_SIZE } from "../constants"
import type { CoverageData, DashboardPerms, TeamTasksData } from "../types"

const ALL: DashboardPerms = { tasks: true, reports: true, attention: true }

// One skeleton per dashboard widget. Each mirrors its widget's markup, classes and item counts, and every
// `lh` is the real line-box height measured in the browser, so the skeleton and the loaded widget are the same size.
// When a widget's layout changes, update its skeleton here too.

function CardHead({ sub = true, action, title = 190, subW = 240 }: { sub?: boolean; action?: number; title?: number; subW?: number }) {
  return (
    <div className="card-head">
      <div>
        <Sk w={title} h={18} lh={28} />
        {sub && <Sk w={subW} h={11} lh={17} style={{ marginTop: 2 }} />}
      </div>
      {action && <Sk w={action} h={37} r="pill" />}
    </div>
  )
}

const St = ({ w = 84 }: { w?: number }) => <Sk w={w} h={29.4} r={8} />

// Browser-measured: the subtitle is ~390px wide (so the buttons wrap below it at 768), buttons 133/190 x 48.3, and the
// subtitle wraps on phones.
export function PageHeaderSkeleton({ perms = ALL }: { perms?: DashboardPerms }) {
  return <PageHeadSkeleton actions={[...(perms.tasks ? [133] : []), ...(perms.reports ? [190] : [])]} btn={48.3} sub={390} wrap />
}

// Notes are ghost text (the real note, transparent, in the real .note element) so they wrap exactly like the loaded ones at every
// width. Without `notes` it falls back to bars: `wraps[i]` adds a second line from 1241px up.
type SkNote = { highlight?: string; text: string; tone?: string }
export function SectionCardsSkeleton({ wraps = [], notes }: { wraps?: boolean[]; notes?: SkNote[] }) {
  return (
    <section className="stats">
      {Array.from({ length: 4 }, (_, i) => (
        <article key={i} className="stat">
          <div className="stat-top">
            <Sk w="55%" h={14} lh={22} />
            <Sk w={38} h={38} r="circle" />
          </div>
          <Sk w={90} h={40} r={10} lh={46} className="sk-val" style={{ marginTop: "auto" }} />
          {notes?.[i] ? (
            <div className="note">
              {notes[i].highlight && <span className={`sk-ghost ${notes[i].tone ?? ""}`}>{notes[i].highlight}</span>}
              <span className="sk-ghost">{notes[i].text}</span>
            </div>
          ) : (
            <span>
              <Sk w="70%" h={11} lh={17} />
              {wraps[i] && <Sk w="40%" h={11} lh={18} className="sk-wrap-xl" />}
            </span>
          )}
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

export function DailyReportSkeleton({ canRemind = true }: { canRemind?: boolean }) {
  return (
    <div className="card deadline">
      <Sk w={170} h={16} lh={24.6} style={{ marginBottom: 4 }} />
      <Sk w={190} h={26} r={8} lh={33.6} style={{ margin: "10px 0 2px" }} />
      <Sk w={150} h={11} lh={17.4} />
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
      {canRemind && <Sk w="100%" h={46.3} r={14} style={{ marginTop: 12 }} />}
    </div>
  )
}

export function ManagerAttentionSkeleton({ canDecide = true }: { canDecide?: boolean }) {
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
              {canDecide && <Sk w={62} h={29.4} r={8} />}
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

// Rows are capped at the page size, with a pager row when there are more tasks (count ignores the client-side department filter).
// Column widths and line wraps in this table depend on the row text, so each cell renders the real text as a transparent
// `.sk-ghost` (a tinted block that wraps exactly like the text). The table then lays out identically at every width.
export function TeamTasksSkeleton({ canAssign = true, tasks = [] }: { canAssign?: boolean; tasks?: TeamTasksData["tasks"] }) {
  const g = (text: string) => <span className="sk-ghost">{text}</span>
  return (
    <div className="card">
      {/* "Showing all departments" is the widest line, so the buttons stay beside it on phones like the real head. */}
      <CardHead action={canAssign ? 128 : undefined} title={110} subW={141} />
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
            {tasks.slice(0, TEAM_TASKS_PAGE_SIZE).map((t) => (
              <tr key={t.ref}>
                <td>
                  <div className="pers">
                    <Sk w={34} h={34} r="circle" />
                    <div><div className="tt">{g(t.name)}</div><div className="tm">{g(t.role)}</div></div>
                  </div>
                </td>
                <td><div className="tt team-link">{g(t.task)}</div><div className="tm num">{g(t.ref)}</div></td>
                <td><span className="dep-tag sk-ghost">{t.dept}</span></td>
                <td><Sk w={16} h={12} r={2} /></td>
                <td className="num due">{g(`${t.due}${t.late ? " · late" : ""}`)}</td>
                <td><span className="st sk-ghost">{t.status.label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.length > TEAM_TASKS_PAGE_SIZE && <PagerSkeleton rows={tasks.length} size={TEAM_TASKS_PAGE_SIZE} />}
    </div>
  )
}

export function CoverageFilesSkeleton({ items }: { items?: CoverageData["coverage"] }) {
  return (
    <div className="card">
      <CardHead />
      <div className="cov">
        {/* Ghost text with the real coverage rows so the detail wraps like the loaded one (1 or 2 lines depending on width). */}
        {(items ?? [{ title: "", detail: "" }, { title: "", detail: "" }, { title: "", detail: "" }]).map((c, i) => (
          <div key={i} className="cov-row">
            <span className="n"><Sk w={36} h={28} r={8} lh={38} style={{ margin: "0 4px" }} /></span>
            <div className="tx">
              <b className="sk-ghost">{c.title || "Coverage"}</b>
              <small className="sk-ghost">{c.detail || "Detail"}</small>
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

export function DashboardSkeleton({ perms = ALL, teamTasks = [], noteWraps, notes, coverage }: { perms?: DashboardPerms; teamTasks?: TeamTasksData["tasks"]; noteWraps?: boolean[]; notes?: SkNote[]; coverage?: CoverageData["coverage"] }) {
  return (
    <SkGroup label="Loading dashboard" className="sk-page">
      <PageHeaderSkeleton perms={perms} />
      <SectionCardsSkeleton wraps={noteWraps} notes={notes} />
      <section className="grid-2 dash-fix dash-fix-a">
        <TasksClosedSkeleton />
        <DailyReportSkeleton canRemind={perms.reports} />
      </section>
      <section className="grid-2 dash-fix dash-fix-b">
        <ManagerAttentionSkeleton canDecide={perms.attention} />
        <TaskProgressSkeleton />
      </section>
      <section className="grid-2">
        <TeamTasksSkeleton canAssign={perms.tasks} tasks={teamTasks} />
        <CoverageFilesSkeleton items={coverage} />
      </section>
    </SkGroup>
  )
}

// Staff dashboard (staff-dashboard-view.tsx). Items match .item in my-tasks / evidence-list / recent-comments.

function StaffItemsSkeleton({ count }: { count: number }) {
  return (
    <div className="list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="item">
          <Sk w={42} h={42} r={12} />
          <div>
            <Sk w="65%" h={13} lh={20} />
            <Sk w="85%" h={11} lh={17} style={{ marginTop: 2 }} />
          </div>
          <div className="r"><St /></div>
        </div>
      ))}
    </div>
  )
}

function StaffCommentsSkeleton() {
  return (
    <div className="card">
      <CardHead />
      <div className="list">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="item">
            <Sk w={42} h={42} r={12} />
            <div>
              <Sk w="75%" h={13} lh={20} />
              {/* Comment text is clamped to two lines, then the timestamp line. */}
              <Sk w="95%" h={11} lh={17} style={{ marginTop: 2 }} />
              <Sk w="60%" h={11} lh={17} />
              <Sk w="45%" h={11} lh={17} style={{ marginTop: 2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TodayReportSkeleton() {
  return (
    <div className="card deadline">
      <Sk w={130} h={16} lh={25} style={{ marginBottom: 4 }} />
      <Sk w={190} h={26} r={8} lh={33.6} style={{ margin: "10px 0 2px" }} />
      <Sk w={190} h={11} lh={17} />
      <div className="countdown">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="sk-count">
            <Sk w={30} h={20} lh={32} />
            <Sk w={36} h={8} lh={20} />
          </div>
        ))}
      </div>
      <div className="rep-row">
        <div style={{ flex: 1 }}>
          <Sk w={80} h={13} lh={19} />
          <Sk w="70%" h={10} lh={16} />
          <Sk w="80%" h={6} r="pill" style={{ marginTop: 6 }} />
        </div>
        <St w={70} />
      </div>
      <Sk w="100%" h={46} r={14} style={{ marginTop: 12 }} />
    </div>
  )
}

export function StaffDashboardSkeleton({ reportOwner = true, noteWraps, notes }: { reportOwner?: boolean; noteWraps?: boolean[]; notes?: SkNote[] }) {
  return (
    <SkGroup label="Loading dashboard" className="sk-page">
      <PageHeadSkeleton />
      <SectionCardsSkeleton wraps={noteWraps} notes={notes} />
      <section className="grid-2">
        <div className="staff-col">
          <div className="card">
            <CardHead action={110} />
            <StaffItemsSkeleton count={8} />
          </div>
          <div className="card">
            <CardHead />
            <StaffItemsSkeleton count={3} />
          </div>
        </div>
        <div className="staff-col">
          {reportOwner && <TodayReportSkeleton />}
          <StaffCommentsSkeleton />
        </div>
      </section>
    </SkGroup>
  )
}
