import { When } from "@/components/when"
import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { TEAM_TASKS_PAGE_SIZE } from "../constants"
import { formatDue } from "@/lib/dates"
import { todayCounts, todayHasNews } from "@/lib/today"
import { TodayChipCounts, teamLines, todaySub } from "./today-copy"
import type { TodayData } from "@/lib/today-data"
import type { CoverageData, DashboardPerms, ManagerAttentionData, TaskProgressData, ReportDeadlineCardData, StaffCommentsData, StaffEvidenceData, StaffMyTasksData, TeamTasksData } from "../types"

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

/** Today card (today-card.tsx): the accordion bar, plus the open body in "card" mode. Mode comes from the same cookies the page reads. */
export type TodaySk = { mode: "card" | "chip"; tiles: number; team: boolean; data?: TodayData }
const gh = { alignSelf: "flex-start" } as const
export function TodayCardSkeleton({ mode, tiles, team, data }: TodaySk) {
  // With the real data the texts are ghost text, so the tiles, team lines and subtitle wrap like the loaded card (phones).
  const counts = data && todayCounts(data.tasks, data.now, data.review)
  const open = mode === "card"
  const bar = (
    <div className="today-bar" aria-expanded={open}>
      <Sk w={72} h={15} lh={22} />
      <span className="today-peek">{counts ? <TodayChipCounts counts={counts} /> : <span className="today-chip-m"><Sk w={120} h={12} lh={19} /></span>}</span>
      {counts && todayHasNews(counts, data!.team) && <span className="today-pulse" />}
      <Sk w={open ? 29 : 36} h={12} lh={19} />
      <Sk w={16} h={16} r={4} />
    </div>
  )
  if (!open)
    return (
      <div className="card today" data-slot="accordion-item" aria-hidden="true">
        {bar}
      </div>
    )
  const labels = counts && [
    [counts.overdue, "Overdue"],
    [counts.dueToday, "Due today"],
    [counts.high, "High priority"],
    ...(data!.team ? [[counts.review, "Waiting for my review"]] : []),
    [counts.blocked, "Blocked"],
  ]
  const t = data?.team
  const lines = t && counts && teamLines(t, counts.reports).map((l) => `${l.n} ${l.label}${l.who ? ` · ${l.who}` : ""}`)
  return (
    <div className="card today" data-slot="accordion-item" aria-hidden="true">
      {bar}
      <div data-slot="accordion-content">
        <div className="today-body">
          <div className="today-head">
            {data ? <div className="sub"><span className="sk-ghost">{todaySub(data.day)}</span></div> : <Sk w={120} h={11} lh={17} />}
            <div className="today-actions">
              <Sk w={151.3} h={36.6} r="pill" />
              <Sk w={107.9} h={36.6} r="pill" />
            </div>
          </div>
          <ul className="today-tiles" data-n={labels?.length ?? tiles}>
            {(labels ?? Array.from({ length: tiles }, () => null)).map((l, i) => (
              <li key={i}>
                <div className="today-tile">
                  {l ? (
                    <>
                      <b className="sk-ghost" style={gh}>{l[0]}</b>
                      <span className="sk-ghost" style={gh}>{l[1]}</span>
                    </>
                  ) : (
                    <>
                      <Sk w={34} h={26} lh={34} />
                      <Sk w={90} h={11} lh={18} />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {team && (
            <div className="today-team">
              {lines ? <div className="today-team-h"><span className="sk-ghost">Team today</span></div> : <Sk w={80} h={11} lh={18} />}
              <ul className="today-team-l">
                {(lines ?? [200, 180, 190]).map((w, i) => (
                  <li key={i}>{typeof w === "string" ? <span className="sk-ghost">{w}</span> : <Sk w={w} h={12} lh={20} />}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const St = ({ w = 84 }: { w?: number }) => <Sk w={w} h={29.4} r={8} />

// Browser-measured: the subtitle is ~302px wide, buttons 133/190 x 48.3, and the
// subtitle wraps on phones.
export function PageHeaderSkeleton({ perms = ALL }: { perms?: DashboardPerms }) {
  return <PageHeadSkeleton actions={[...(perms.tasks ? [133] : []), ...(perms.reports ? [190] : [])]} btn={48.3} sub={302} wrap />
}

// Notes are ghost text (the real note, transparent, in the real .note element) so they wrap exactly like the loaded ones at every
// width. Without `notes` it falls back to bars: `wraps[i]` adds a second line from 1241px up.
type SkNote = { highlight?: string; text: string; tone?: string }
export function SectionCardsSkeleton({ wraps = [], notes }: { wraps?: boolean[]; notes?: SkNote[] }) {
  return (
    <section className="stats dash-stats">
      {Array.from({ length: 4 }, (_, i) => (
        <article key={i} className="stat">
          <div className="stat-top">
            <div className="stat-title">
              <Sk w={32} h={32} r={10} />
              <Sk w={110} h={14} lh={22} />
            </div>
            <Sk w={38} h={38} r="circle" />
          </div>
          <div className="stat-mid">
            <Sk w={90} h={40} r={10} lh={46} className="sk-val" />
            <Sk w={120} h={44} r={10} className="sk-spark" />
          </div>
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
          <Sk w={62} h={11} lh={17} style={{ marginTop: 2 }} />
        </div>
        <div className="legend">
          <Sk w={70} h={11} lh={17} />
          <Sk w={100} h={11} lh={17} />
          <Sk w={56} h={11} lh={17} />
        </div>
      </div>
      {/* One column per day band (no gap) so the 48% bar = the chart's barCategoryGap 26% each side. */}
      <div className="rc-bars sk-bars">
        {heights.map((h, i) => (
          <div key={i}>
            <Sk w="48%" h={`${h}%`} r="pill" style={{ maxWidth: 72 }} />
            <Sk w={14} h={10} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Shift report deadline card (report-deadline-card.tsx): the real text as ghost text so lines wrap exactly like the loaded card.
// Gets the same server data as the page; undefined = the page shows no card either.
export function ReportDeadlineSkeleton({ data, canRemind }: { data?: ReportDeadlineCardData; canRemind: boolean }) {
  if (!data) return null
  const g = (text: string) => <span className="sk-ghost">{text}</span>
  return (
    <div className="card deadline">
      <h2>{g(data.title)}</h2>
      <div className="big">{g(data.dueLabel)}</div>
      <div className="tz">{g(data.note)}</div>
      <div className="countdown">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="sk-count">
            <Sk w={30} h={20} lh={32} />
            <Sk w={36} h={8} lh={20} />
          </div>
        ))}
      </div>
      {data.rows.map((r) => (
        <div key={r.key} className="rep-row">
          <div>
            <span className="dep">{g(r.label)}</span>
            <small>{g(r.detail)}</small>
            {r.progress !== undefined && <Sk w={110} h={6} r={6} style={{ display: "block", marginTop: 6 }} />}
          </div>
          <span className="st sk-ghost">{r.status.label}</span>
        </div>
      ))}
      {(data.kind === "member" || (canRemind && data.missing > 0)) && <Sk w="100%" h={46.3} r={14} style={{ marginTop: 12 }} />}
    </div>
  )
}

// Real titles and notes as ghost text: they wrap to 2 or 3 lines on phones.
export function ManagerAttentionSkeleton({ canDecide = true, data }: { canDecide?: boolean; data?: ManagerAttentionData }) {
  const items = data?.items ?? Array.from({ length: 4 }, () => null)
  return (
    <div className="card">
      <CardHead action={129} subW={47} />
      <div className="list">
        {items.map((it, i) => (
          <div key={i} className="item">
            <Sk w={42} h={42} r={12} />
            {it ? (
              <div>
                <div className="t"><span className="sk-ghost">{it.title}</span></div>
                <div className="m"><span className="sk-ghost">Raised by {it.by} · {it.note}</span></div>
              </div>
            ) : (
              <div>
                <Sk w="65%" h={13} lh={20} />
                <Sk w="85%" h={11} lh={17} style={{ marginTop: 2 }} />
              </div>
            )}
            <div className="r">
              {it ? <span className="st sk-ghost">{it.status.label}</span> : <St />}
              {canDecide && <Sk w={62} h={29.4} r={8} />}
            </div>
          </div>
        ))}
      </div>
      <div className="att-sum">
        {(data ? [...new Set(data.items.map((it) => it.status.label))] : ["", "", ""]).map((l, i) => (
          <div key={i} className="att-tile">
            <Sk w={18} h={22} r={6} lh={28} />
            {l ? <span className="sk-ghost">{l}</span> : <Sk w={48} h={11} lh={17} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TaskProgressSkeleton({ data }: { data?: TaskProgressData }) {
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
        <ul className="gauge-list">
          {(data?.legend ?? [{ key: "solid" }, { key: "deep" }, { key: "striped" }]).map((l) => (
            <li key={l.key}>
              <div className="gl-row">
                <i className={`sw ${l.key}`} />
                <span className="gl-lbl"><Sk w={80} h={11} lh={17} /></span>
                <Sk w={22} h={11} lh={17} />
                <span className="gl-pct"><Sk w={28} h={11} lh={17} /></span>
              </div>
              <div className="gl-track" />
            </li>
          ))}
        </ul>
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
      {/* "All departments" is the widest subtitle (90px). */}
      <CardHead action={canAssign ? 128 : undefined} title={110} subW={90} />
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
      <CardHead subW={74} />
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

export function DashboardSkeleton({ perms = ALL, teamTasks = [], noteWraps, notes, coverage, today, deadline, attention, progress }: { attention?: ManagerAttentionData; progress?: TaskProgressData; today?: TodaySk; deadline?: ReportDeadlineCardData; perms?: DashboardPerms; teamTasks?: TeamTasksData["tasks"]; noteWraps?: boolean[]; notes?: SkNote[]; coverage?: CoverageData["coverage"] }) {
  return (
    <SkGroup label="Loading dashboard" className="sk-page">
      <PageHeaderSkeleton perms={perms} />
      {today && <TodayCardSkeleton {...today} />}
      <SectionCardsSkeleton wraps={noteWraps} notes={notes} />
      <section className="grid-3 dash-fix dash-fix-a">
        <TasksClosedSkeleton />
        <TaskProgressSkeleton data={progress} />
        <ReportDeadlineSkeleton data={deadline} canRemind={perms.reports} />
      </section>
      <section className="grid-2 dash-fix dash-fix-c">
        <ManagerAttentionSkeleton canDecide={perms.attention} data={attention} />
        <CoverageFilesSkeleton items={coverage} />
      </section>
      <TeamTasksSkeleton canAssign={perms.tasks} tasks={teamTasks} />
    </SkGroup>
  )
}

// Staff dashboard (staff-dashboard-view.tsx). Items match .item in my-tasks / evidence-list / recent-comments.

type StaffRow = { title: string; meta: React.ReactNode; pill: string }

// `.item` rows of "My tasks" / "Waiting on review"; with `rows` the real title and note are ghost text, so wrapped lines match on phones.
function StaffItemsSkeleton({ count, rows }: { count: number; rows?: StaffRow[] }) {
  return (
    <div className="list">
      {(rows ?? Array.from({ length: count }, () => null)).map((r, i) => (
        <div key={i} className="item">
          <Sk w={42} h={42} r={12} />
          {r ? (
            <div>
              <div className="t"><span className="sk-ghost">{r.title}</span></div>
              <div className="m"><span className="sk-ghost">{r.meta}</span></div>
            </div>
          ) : (
            <div>
              <Sk w="65%" h={13} lh={20} />
              <Sk w="85%" h={11} lh={17} style={{ marginTop: 2 }} />
            </div>
          )}
          <div className="r">{r ? <span className="st sk-ghost">{r.pill}</span> : <St />}</div>
        </div>
      ))}
    </div>
  )
}

// Recent comments card (recent-comments.tsx): the real title and clamped text as ghost text, since the title can wrap to a second line.
function StaffCommentsSkeleton({ data, today, tzLabel }: { data?: StaffCommentsData; today: string; tzLabel: string }) {
  const items = data?.items ?? Array.from({ length: 3 }, () => null)
  return (
    <div className="card">
      <CardHead />
      <div className="list">
        {items.map((c, i) => {
          const at = c ? formatDue(c.at, today) : ""
          return (
            <div key={i} className="item">
              <Sk w={42} h={42} r={12} />
              {c ? (
                <div>
                  <div className="t"><span className="sk-ghost">{c.title}</span></div>
                  <div className="m clamp"><span className="sk-ghost">{c.by} \u00b7 {c.text}</span></div>
                  <div className="m"><span className="sk-ghost">{at}{at.includes(":") && tzLabel ? ` ${tzLabel}` : ""}</span></div>
                </div>
              ) : (
                <div>
                  <Sk w="75%" h={13} lh={20} />
                  {/* Comment text is clamped to two lines, then the timestamp line. */}
                  <Sk w="95%" h={11} lh={17} style={{ marginTop: 2 }} />
                  <Sk w="60%" h={11} lh={17} />
                  <Sk w="45%" h={11} lh={17} style={{ marginTop: 2 }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StaffDashboardSkeleton({ deadline, noteWraps, notes, today, comments, myTasks, evidence, date, tzLabel = "" }: { today?: TodaySk; comments?: StaffCommentsData; myTasks?: StaffMyTasksData; evidence?: StaffEvidenceData; date?: string; tzLabel?: string; deadline?: ReportDeadlineCardData; noteWraps?: boolean[]; notes?: SkNote[] }) {
  return (
    <SkGroup label="Loading dashboard" className="sk-page">
      <PageHeadSkeleton />
      {today && <TodayCardSkeleton {...today} />}
      <SectionCardsSkeleton wraps={noteWraps} notes={notes} />
      <section className="grid-2">
        <div className="staff-col">
          <div className="card">
            <CardHead action={110} />
            <StaffItemsSkeleton
              count={8}
              rows={myTasks?.tasks.map((t) => ({ title: t.title, meta: <>{t.ref} · Due <b><When iso={t.due} today={date ?? ""} tzLabel={tzLabel} /></b></>, pill: t.status.label }))}
            />
          </div>
          <div className="card">
            <CardHead />
            <StaffItemsSkeleton
              count={3}
              rows={evidence?.items.map((e) => ({
                title: e.title,
                meta: e.state === "returned" ? <><b>{e.reviewer}</b> returned it: {e.reason}</> : <>Sent <When iso={e.at} today={date ?? ""} tzLabel={tzLabel} /> · with <b>{e.reviewer}</b></>,
                pill: e.status.label,
              }))}
            />
          </div>
        </div>
        <div className="staff-col">
          <ReportDeadlineSkeleton data={deadline} canRemind={false} />
          <StaffCommentsSkeleton data={comments} today={date ?? ""} tzLabel={tzLabel} />
        </div>
      </section>
    </SkGroup>
  )
}
