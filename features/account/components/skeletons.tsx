import { PageHeadSkeleton } from "@/components/page-head"
import { PagerSkeleton, needsPager, pageRows } from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { ACTIVITY_PAGE_SIZE } from "../constants"
import { ACCOUNT_TABS } from "../types"
import type { AccountTabId } from "../types"

// Mirrors AccountLayout (PageHead, .set-layout tab list, .set-body) and each tab's panel with the seed's row counts.
// Heights reuse the settings measures (h2 line 28, .sub line 17, field label 18, control 44, hint 18, button 48; small button 38).
export type AccountCounts = { sessions: number; others: number; activity: number; events: number; channels: number }

// `wrap`: the subtitle wraps to a second line on phones (≤640, .sk-wrap); browser-measured at 390.
const CardHead = ({ title, sub, button, wrap }: { title: number; sub: number; button?: number; wrap?: boolean }) => (
  <div className="card-head">
    <div>
      <Sk w={title} h={18} lh={28} />
      <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />
      {wrap && <Sk w={sub / 2} h={11} lh={17.8} className="sk-wrap" />}
    </div>
    {button ? <Sk w={button} h={36.8} r={12} /> : null}
  </div>
)

// Browser-measured: label line 18.1, hint line 17.4 plus the hint's 6px top margin (on top of the 6px field gap).
const FieldSk = ({ label = 90, hint }: { label?: number; hint?: number }) => (
  <div className="od-field">
    <Sk w={label} h={11} lh={18.1} />
    <Sk h={44} r={14} />
    {hint ? <Sk w={hint} h={10} lh={17.4} style={{ marginTop: 6 }} /> : null}
  </div>
)

function Profile() {
  return (
    <section className="card set-card">
      <CardHead title={70} sub={180} />
      <div className="acc-id">
        <Sk w={56} h={56} r="circle" />
        <div className="acc-id-text">
          <Sk w={130} h={14} lh={24} />
          <Sk w={150} h={11} lh={20} />
        </div>
      </div>
      <div className="od-form set-form">
        <div className="od-row2"><FieldSk label={90} /><FieldSk label={40} hint={260} /></div>
        <div className="od-row2"><FieldSk label={36} /><FieldSk label={80} /></div>
        <div className="od-row2"><FieldSk label={64} hint={150} /></div>
        <div className="od-form-foot"><Sk w={140} h={44.3} r={14} /></div>
      </div>
    </section>
  )
}

function Security({ counts }: { counts: AccountCounts }) {
  const acts = pageRows(counts.activity, ACTIVITY_PAGE_SIZE)
  return (
    <>
      <section className="card set-card">
        <CardHead title={90} sub={330} button={144} wrap />
        <div className="set-switch-row acc-mfa">
          <Sk w={40} h={24} r="pill" />
          <span className="acc-mfa-text">
            <Sk w={140} h={13} lh={19.6} />
            <Sk w={260} h={10} lh={16} />
            <Sk w={120} h={10} lh={16} className="sk-wrap" />
          </span>
        </div>
      </section>
      <section className="card set-card">
        <CardHead title={130} sub={90} button={206} />
        <ul className="set-list">
          {Array.from({ length: counts.sessions }, (_, i) => (
            <li key={i} className="acc-sess">
              <Sk w={40} h={40} r={12} />
              <div className="acc-sess-main">
                {/* the current session's top line also holds its 34px "This device" pill */}
                {i === 0 ? (
                  <span className="acc-sess-top"><Sk w={150} h={13} lh={22} /><Sk w={102} h={34} r={8} /></span>
                ) : (
                  <>
                    <Sk w={150} h={13} lh={22} />
                    {/* phones: the seeded device name wraps to 2 lines and the last-seen line to 3 */}
                    <Sk w={90} h={13} lh={22} className="sk-wrap" />
                  </>
                )}
                <Sk w={200} h={10} lh={16} />
                {i > 0 && (
                  <>
                    <Sk w={160} h={10} lh={16} className="sk-wrap" />
                    <Sk w={100} h={10} lh={16} className="sk-wrap" />
                  </>
                )}
              </div>
              {i > 0 && <Sk w={81} h={36.8} r={12} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="card set-card">
        <CardHead title={140} sub={290} />
        <ul className="set-list">
          {Array.from({ length: acts }, (_, i) => (
            <li key={i} className="acc-act">
              <Sk w={200} h={13} lh={20} />
              <Sk w={110} h={10} lh={16} />
            </li>
          ))}
        </ul>
        {needsPager(counts.activity, ACTIVITY_PAGE_SIZE) && <PagerSkeleton rows={counts.activity} size={ACTIVITY_PAGE_SIZE} />}
      </section>
    </>
  )
}

function Notifications({ counts }: { counts: AccountCounts }) {
  return (
    <>
      <section className="card set-card">
        <CardHead title={90} sub={280} />
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>
                <th><Sk w={50} h={10} lh={16} /></th>
                {Array.from({ length: counts.channels }, (_, i) => <th key={i}><Sk w={50} h={10} lh={16} /></th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: counts.events }, (_, r) => (
                <tr key={r}>
                  <td>
                    <Sk w={150} h={13} lh={19} className="sk-2l" />
                    <Sk w={190} h={10} lh={16} style={{ marginTop: 2 }} className="sk-2s" />
                  </td>
                  {Array.from({ length: counts.channels }, (_, i) => <td key={i}><Sk w={40} h={24} r="pill" /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card set-card">
        <CardHead title={120} sub={250} />
        <div className="od-form set-form">
          <div className="od-row2"><FieldSk label={70} hint={210} /></div>
        </div>
      </section>
    </>
  )
}

export function AccountSkeleton({ tab, counts }: { tab: AccountTabId; counts: AccountCounts }) {
  return (
    <SkGroup label="Loading account" className="sk-page">
      <PageHeadSkeleton wrap />
      <div className="set-layout">
        <nav className="set-tabs" aria-hidden="true">
          {ACCOUNT_TABS.map((t) => (
            <span key={t.id} className="set-tab">
              <Sk w={18} h={18} r={6} />
              <Sk w={70 + (t.label.length % 5) * 8} h={12} lh={19.6} />
            </span>
          ))}
        </nav>
        <div className="set-body">
          {tab === "profile" && <Profile />}
          {tab === "security" && <Security counts={counts} />}
          {tab === "notifications" && <Notifications counts={counts} />}
        </div>
      </div>
    </SkGroup>
  )
}
