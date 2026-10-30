import { When } from "@/components/when"
import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { REPORT_PAGE_SIZE } from "../types"

// Mirrors ReportsView with the same classes and counts (loading.tsx passes the real numbers from the same seed):
//  - own scope: prompt card (one row per report that needs the member), "My shift report" card, "My reports" list (no person column)
//  - team / all scope: the inbox with the status count chips, team select when there is more than one team, person column.
const CardHead = ({ title, sub, button, pill }: { title: number; sub: number; button?: boolean; pill?: boolean }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={16} lh={pill ? 24 : 28} />
      <Sk w={sub} h={10} lh={pill ? 20.9 : 18} style={{ marginTop: 2 }} />
    </div>
    {button && <Sk w={112} h={46} r={14} />}
    {pill && <Sk w={84} h={29.4} r={8} />}
  </div>
)

/** The member view's real text (built in loading.tsx from the same seed) as ghost text, so wrapped lines match on phones. */
export type OwnReportText = {
  prompts: { title: string; text: React.ReactNode; button: string }[]
  mine?: { sub: string; due: string; dueTz?: string; tasks: number; time: string; progress: string; button: string; pill: string }
}

/** One inbox row's real text (first page, built in loading.tsx): ghost text so every wrapped cell matches at any width. */
export type InboxRowSk = { shift: string; meta: string; person?: { name: string; role: string }; team: string; status: string; submitted?: string; late: boolean; tasks: string }

export function ReportsSkeleton({ own = false, prompts = 0, mine = true, rows = 10, teams = 2, ownText, inbox = [], today = "", tzLabel = "" }: { inbox?: InboxRowSk[]; today?: string; tzLabel?: string; own?: boolean; prompts?: number; mine?: boolean; rows?: number; teams?: number; ownText?: OwnReportText }) {
  return (
    <SkGroup label="Loading shift reports" className="sk-page">
      <PageHeadSkeleton wrap sub={own ? 330 : 400} />
      {own && prompts > 0 && (
        <section className="card sr-prompt">
          {ownText ? <h2 className="td-h"><span className="sk-ghost">{prompts === 1 ? "A shift report needs you" : `${prompts} shift reports need you`}</span></h2> : <Sk w={200} h={16} lh={24} style={{ marginBottom: 12 }} />}
          <ul className="sr-prompt-list">
            {Array.from({ length: prompts }, (_, i) => (
              <li key={i}>
                {ownText?.prompts[i] ? (
                  <div className="sr-prompt-main"><strong className="sk-ghost">{ownText.prompts[i].title}</strong><span className="sk-ghost">{ownText.prompts[i].text}</span></div>
                ) : (
                  <div className="sr-prompt-main"><Sk w={170} h={13} lh={20} /><Sk w="80%" h={11} lh={20} /></div>
                )}
                <Sk w={140} h={46.3} r={14} className="sr-prompt-btn" />
              </li>
            ))}
          </ul>
        </section>
      )}
      {own && (mine ? (
        <section className="card sr-mine">
          {ownText?.mine ? (
            <div className="card-head">
              <div>
                <h2><span className="sk-ghost">My shift report</span></h2>
                <div className="sub"><span className="sk-ghost">{ownText.mine.sub}</span></div>
              </div>
              <span className="st sk-ghost">{ownText.mine.pill}</span>
            </div>
          ) : (
            <CardHead title={130} sub={200} pill />
          )}
          <dl className="td-meta sr-mine-meta">
            {(ownText?.mine ? [["Due", ownText.mine.due, ownText.mine.dueTz], ["Tasks", String(ownText.mine.tasks)], ["Time reported", ownText.mine.time]] : [0, 1, 2]).map((v, i) => (
              <div key={i}>
                {typeof v === "number" ? <Sk w={60} h={10} lh={16} /> : <dt>{v[0]}</dt>}
                {typeof v === "number" ? <Sk w={i ? 50 : 130} h={12} lh={i ? 22 : 23} style={{ marginTop: 4 }} /> : <dd><span className="sk-ghost">{v[2] ? <time className="od-when">{v[1]}<span className="od-tz"> {v[2]}</span></time> : v[1]}</span></dd>}
              </div>
            ))}
          </dl>
          <div className="sr-mine-prog">
            {ownText?.mine ? (
              <>
                <span className="tm sk-ghost" style={{ alignSelf: "flex-start" }}>{ownText.mine.progress}</span>
                <div className="progress" aria-hidden="true"><i style={{ width: 0 }} /></div>
              </>
            ) : (
              <>
                <Sk w={160} h={10} lh={20.3} />
                <Sk w="100%" h={6} r={6} style={{ marginTop: 6 }} />
              </>
            )}
          </div>
          <Sk w={160} h={46.3} r={14} className="sr-mine-btn" />
        </section>
      ) : (
        <section className="card sr-mine">
          <Sk w={130} h={16} lh={24} style={{ marginBottom: 12 }} />
          <Sk w={280} h={11} lh={20} />
        </section>
      ))}
      <section className="card sr-inbox">
        <CardHead title={own ? 100 : 120} sub={200} button />
        {!own && (
          // status tab seg (All + five states with counts): 42px buttons + 4px padding
          <div className="sr-counts"><Sk w={568} h={50} r="pill" style={{ maxWidth: "100%" }} /></div>
        )}
        <div className="od-filters">
          <div className="rep-date"><Sk w="100%" h={44} r={14} /></div>
          <div className="rep-date"><Sk w="100%" h={44} r={14} /></div>
          {!own && teams > 1 && <Sk w={140} h={40} r="pill" />}
          {!own && <Sk w={140} h={40} r="pill" />}
          <Sk w={140} h={40} r="pill" />
        </div>
        {rows === 0 ? (
          <div className="od-empty">
            <Sk w={56} h={56} r="circle" />
            <Sk w={150} h={16} lh={28} />
            <Sk w={220} h={12} lh={21} />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="rtable rep-table sr-table">
                <thead>
                  <tr>{(own ? [40, 40, 50, 66, 40] : [40, 50, 40, 50, 66, 40]).map((w, i) => <th key={i}><Sk w={w} h={10} lh={16} /></th>)}</tr>
                </thead>
                <tbody>
                  {Array.from({ length: pageRows(rows, REPORT_PAGE_SIZE) }, (_, i) => (
                    inbox[i] ? (
                      <tr key={i}>
                        <td data-label="Shift">
                          <div className="tt"><span className="sk-ghost">{inbox[i].shift}</span></div>
                          <div className="tm num"><span className="sk-ghost">{inbox[i].meta}</span></div>
                        </td>
                        {!own && (
                          <td data-label="Person">
                            {inbox[i].person && (
                              <div className="pers">
                                <Sk w={34} h={34} r="circle" />
                                <div><div className="tt"><span className="sk-ghost">{inbox[i].person!.name}</span></div><div className="tm"><span className="sk-ghost">{inbox[i].person!.role}</span></div></div>
                              </div>
                            )}
                          </td>
                        )}
                        <td data-label="Team"><span className="dep-tag sk-ghost">{inbox[i].team}</span></td>
                        <td data-label="Status"><span className="st sk-ghost">{inbox[i].status}</span></td>
                        <td data-label="Submitted" className="num due">
                          <span className="sk-ghost">{inbox[i].submitted ? <When iso={inbox[i].submitted!} today={today} tzLabel={tzLabel} /> : "Not submitted"}{inbox[i].late ? " · late" : ""}</span>
                        </td>
                        <td data-label="Tasks" className="num"><span className="sk-ghost">{inbox[i].tasks}</span></td>
                      </tr>
                    ) : (
                    <tr key={i}>
                        <td data-label="Shift"><Sk w={150} h={12} lh={18.84} className="sk-2l" /><Sk w={130} h={10} lh={15.94} className="sk-2s" /></td>
                        {!own && (
                          <td data-label="Person">
                            <div className="pers">
                              <Sk w={34} h={34} r="circle" />
                              <div><Sk w={96} h={12} lh={18.84} /><Sk w={80} h={10} lh={15.94} /></div>
                            </div>
                          </td>
                        )}
                        <td data-label="Team"><Sk w={58} h={19} r={6} className="sk-dep" /></td>
                        <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                        <td data-label="Submitted"><Sk w={110} h={12} lh={18.8} /></td>
                        <td data-label="Tasks"><Sk w={50} h={12} lh={18.8} /></td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
            {needsPager(rows, REPORT_PAGE_SIZE) && <PagerSkeleton rows={rows} size={REPORT_PAGE_SIZE} />}
          </>
        )}
      </section>
    </SkGroup>
  )
}

/**
 * Mirrors ReportPage. loading.tsx gets no params, so counts are typical values: `edit` = the member's editor (task rows with
 * inputs, notes card with summary, blockers, unplanned, attachments, one extra section), otherwise the read-only review
 * (task table, notes, version history, tools); `review` adds the Return / Accept buttons.
 */
export function ReportPageSkeleton({ edit = false, review = false, items = 5 }: { edit?: boolean; review?: boolean; items?: number }) {
  return (
    <SkGroup label="Loading shift report" className="sk-page">
      <span className="td-back"><Sk w={110} h={12} lh={20} /></span>
      <div className="head">
        <div>
          <span className="sk-line rf-sk-h1"><Sk w={220} h="var(--sk-h1,32px)" r={10} /></span>
          <Sk w={360} h={14} lh={20} style={{ marginTop: 8 }} />
        </div>
        {(edit || review) && (
          <div className="head-actions">
            <Sk w={review ? 190 : 120} h="var(--sk-btn-h,48px)" r={14} className={review ? "rf-sk-btn rf-sk-wide" : "rf-sk-btn"} />
            <Sk w={120} h="var(--sk-btn-h,48px)" r={14} className="rf-sk-btn" />
          </div>
        )}
      </div>
      <div className="sr-col">
        <section className="card">
          <dl className="td-meta">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i}>
                <Sk w={64} h={10} lh={16} />
                {i === 3 ? <Sk w={84} h={29.4} r={8} style={{ marginTop: 4 }} /> : <Sk w={120} h={12} lh={22} style={{ marginTop: 4 }} />}
              </div>
            ))}
          </dl>
        </section>
        <section className="card">
          <CardHead title={150} sub={edit ? 300 : 60} />
          <div className="table-wrap">
            <table className={`rtable sr-items${edit ? " sr-items-edit" : ""}`}>
              <thead><tr>{[40, 46, 60, 40].map((w, i) => <th key={i}><Sk w={w} h={10} lh={16} /></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: items }, (_, i) => (
                  <tr key={i}>
                    <td data-label="Task"><Sk w={170} h={12} lh={18.84} /><Sk w={120} h={10} lh={15.94} /></td>
                    {edit ? (
                      <>
                        <td data-label="Status" className="sr-status"><Sk w={140} h={40} r="pill" /></td>
                        <td data-label="Time (min)"><Sk w="100%" h={40} r={12} /></td>
                        <td data-label="Note"><Sk w="100%" h={40} r={12} /></td>
                      </>
                    ) : (
                      <>
                        <td data-label="Status"><Sk w={84} h={29.4} r={8} /></td>
                        <td data-label="Time"><Sk w={40} h={12} lh={18.8} /></td>
                        <td data-label="Note"><Sk w={160} h={12} lh={18.8} /></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card sr-notes">
          {edit ? (
            <>
              {[0, 1].map((i) => (
                <div key={i} className="od-field"><Sk w={80} h={11} lh={18} /><Sk w="100%" h={96} r={14} /></div>
              ))}
              {[0, 1, 2].map((i) => (
                <div key={i} className="sr-set"><Sk w={120} h={12} lh={20} /><Sk w={190} h={34} r="pill" /></div>
              ))}
            </>
          ) : (
            [0, 1, 2, 3, 4].map((i) => (
              <div key={i}><Sk w={110} h={16} lh={24} style={{ marginBottom: 12 }} /><Sk w="70%" h={12} lh={22} /></div>
            ))
          )}
        </section>
        {!edit && (
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
              {[120, 120].map((w, i) => <Sk key={i} w={w} h={48} r={14} />)}
            </section>
          </>
        )}
      </div>
    </SkGroup>
  )
}
