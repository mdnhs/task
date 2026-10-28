import { PageHeadSkeleton } from "@/components/page-head"
import {
  PagerSkeleton,
  needsPager,
} from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import {
  DEPARTMENTS_PAGE_SIZE,
  DELIVERY_PAGE_SIZE,
  GRANTS_PAGE_SIZE,
  INVITES_PAGE_SIZE,
  USERS_PAGE_SIZE,
} from "../constants"
import { nextReminder, reminderSchedule } from "@/lib/notify"
import { daysBetween, formatDate, formatDue, formatTime } from "@/lib/dates"
import { SUPPORT_STATUS, supportRows, type SupportAccess } from "@/lib/support-access"
import { SETTINGS_TABS } from "../types"
import type { DeliveryRow, Department, Integration, Invite, MatrixData, NotificationsData, SettingsTabId, SettingsUser, TemplateData } from "../types"

// Mirrors SettingsLayout (PageHead, tab list, .set-body) and each tab's panel with the same classes and the seed's row counts.
// Heights reuse the dashboard/attention measures (h2 line 28, .sub line 17, field label 18, control 44, table cell rows 19/16).
export type SettingsCounts = {
  users: number
  invites: number
  departments: number
  modules: number
  roles: number
  /** first department's template sections: field count when enabled, null when disabled */ sections: (
    number | null
  )[]
  templateDepts: number
  brandNameLines: number
  events: number
  intervals: number
  integrations: number
  grants: number
  /** Seed text, so the skeleton wraps like the loaded panels. Everything is optional: without it the blocks are plain bars. */
  data?: SettingsSkeletonData
}

export type SettingsSkeletonData = {
  tzLabel: string
  today: string
  weekendRules: string[]
  departments: Department[]
  users: SettingsUser[]
  invites: Invite[]
  integrations: Integration[]
  grants: SupportAccess[]
  roleLabels: Record<string, string>
  deadline: string
  matrix?: MatrixData
  template?: TemplateData
  notifications?: NotificationsData
  deliveryLog?: DeliveryRow[]
}

// Transparent text on the skeleton tint (see .sk-ghost in dashboard.css): wraps exactly like the loaded text.
const g = (text: React.ReactNode) => <span className="sk-ghost">{text}</span>
const when = (iso: string, today: string, tzLabel: string, mode: "due" | "date" = "due") => {
  const text = mode === "date" ? formatDate(iso) : formatDue(iso, today)
  return <time className="od-when">{text}{mode === "due" && text.includes(":") && tzLabel ? <span className="od-tz"> {tzLabel}</span> : null}</time>
}

// A string title/sub renders the real text (ghost) in the real h2 / .sub, so a subtitle that wraps on phones wraps here too.
const CardHead = ({
  title,
  sub,
  button,
  extra,
}: {
  title: number | string
  sub: number | string
  button?: number
  extra?: React.ReactNode
}) => (
  <div className="card-head">
    <div>
      {typeof title === "string" ? <h2>{g(title)}</h2> : <Sk w={title} h={18} lh={28} />}
      {typeof sub === "string" ? <div className="sub">{g(sub)}</div> : <Sk w={sub} h={11} lh={17} style={{ marginTop: 2 }} />}
    </div>
    {button ? <Sk w={button} h={46.3} r={14} /> : null}
    {extra}
  </div>
)

// Browser-measured: label line 18.1, control 44, hint line 17.4 plus the hint's 6px top margin. `hint={0}` = field without a hint.
// A string label/hint renders the real text (ghost) in the real field markup, so a hint that wraps on phones wraps here too.
const FieldSk = ({
  label = 90,
  hint = 200,
  required,
}: {
  label?: number | string
  hint?: number | string
  required?: boolean
}) => (
  <div className="od-field">
    {typeof label === "string" ? (
      <label>{g(label)}{required && <span className="od-req" aria-hidden="true"> *</span>}</label>
    ) : (
      <Sk w={label} h={11} lh={18.1} />
    )}
    <Sk h={44} r={14} />
    {typeof hint === "string" ? (
      <div className="od-field-msg"><p className="od-field-hint">{g(hint)}</p></div>
    ) : hint ? (
      <Sk w={hint} h={10} lh={17.4} style={{ marginTop: 6 }} />
    ) : null}
  </div>
)

// Form submit button: 44.3px (shadcn Button size lg in .od-form-foot).
const Foot = ({ w = 135 }: { w?: number }) => (
  <div className="od-form-foot">
    <Sk w={w} h={44.3} r={14} />
  </div>
)

function Organisation({ rules, tzLabel }: { rules: string[]; tzLabel: string }) {
  return (
    <section className="card set-card">
      <CardHead title={120} sub={230} />
      <div className="od-form set-form">
        <div className="od-row2">
          <FieldSk label="Company name" hint={0} required />
          <FieldSk label="Subdomain" hint="Set when the workspace was created" />
        </div>
        <div className="od-row2">
          <FieldSk label="Timezone" hint="Deadlines and timestamps use this timezone" />
          <FieldSk label="Report deadline" hint={`Reports are due by this time, ${tzLabel}`} />
        </div>
        <fieldset className="set-fieldset">
          <legend>{g("Weekend and holiday rule")}</legend>
          <div className="od-choices">
            {rules.map((r) => (
              <span key={r} className="od-choice sk-pill"><Sk w={16} h={16} r="circle" />{g(r)}</span>
            ))}
          </div>
        </fieldset>
        <div className="od-row2">
          <FieldSk label="Session timeout" hint="Signed-in users are logged out after this much inactivity" />
        </div>
        <Foot />
      </div>
    </section>
  )
}

function Departments({
  departments,
  canWrite,
  seed,
}: {
  departments: number
  canWrite: boolean
  seed: Department[]
}) {
  return (
    <section className="card set-card">
      <CardHead title={250} sub={110} button={canWrite ? 190 : 0} />
      <ul className="set-list">
        {seed.slice(0, DEPARTMENTS_PAGE_SIZE).map((d) => (
          <li key={d.id} className="set-dep">
            <div className="set-dep-main">
              <span className="set-dep-top">
                <span className="set-dep-name">{g(d.name)}</span>
                <span className="st sk-ghost">{d.active ? "Active" : "Inactive"}</span>
              </span>
              <span className="set-dep-line">{g(<><b>Report owner:</b> {d.reportOwner}</>)}</span>
              <span className="set-dep-line">{g(<><b>Sites:</b> {d.sites.join(", ") || "None"}</>)}</span>
              <span className="set-dep-line">{g(<><b>Teams:</b> {d.teams.join(", ") || "None"}</>)}</span>
            </div>
            {canWrite && (
              <span className="set-actions">
                <span className="btn btn-outline sk-ghost-btn">Edit</span>
                <span className="btn btn-outline sk-ghost-btn">{d.active ? "Deactivate" : "Reactivate"}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {needsPager(departments, DEPARTMENTS_PAGE_SIZE) && (
        <PagerSkeleton rows={departments} size={DEPARTMENTS_PAGE_SIZE} />
      )}
    </section>
  )
}

function Users({
  users,
  invites,
  canWrite,
  data,
}: {
  users: number
  invites: number
  canWrite: boolean
  data?: SettingsSkeletonData
}) {
  const today = data?.today ?? ""
  const tz = data?.tzLabel ?? ""
  const role = (id: string) => data?.roleLabels[id] ?? id
  const dept = (d: string) => (d ? <span className="dep-tag sk-ghost">{d}</span> : <span className="tm">{g("All departments")}</span>)
  const th = (...labels: string[]) => (
    <thead>
      <tr>{labels.map((l) => <th key={l}>{g(l)}</th>)}</tr>
    </thead>
  )
  return (
    <>
      <section className="card set-card">
        <CardHead title={70} sub={190} button={canWrite ? 160 : 0} />
        <div className="od-filters">
          <Sk h={40} r="pill" className="sk-fsearch" />
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable set-table">
            {th("User", "Role", "Department", "Status", "Last active", ...(canWrite ? ["Actions"] : []))}
            <tbody>
              {(data?.users ?? []).slice(0, USERS_PAGE_SIZE).map((u) => (
                <tr key={u.id}>
                  <td data-label="User"><div className="tt">{g(u.name)}</div><div className="tm">{g(u.email)}</div></td>
                  <td data-label="Role">{g(role(u.role))}</td>
                  <td data-label="Department">{dept(u.dept)}</td>
                  <td data-label="Status"><span className="st sk-ghost">{u.status === "active" ? "Active" : "Deactivated"}</span></td>
                  <td data-label="Last active" className="num">{g(when(u.lastActive, today, tz))}</td>
                  {canWrite && <td data-label="Actions"><span className="btn btn-outline set-sm sk-ghost-btn">{u.status === "active" ? "Deactivate" : "Reactivate"}</span></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(users, USERS_PAGE_SIZE) && (
          <PagerSkeleton rows={users} size={USERS_PAGE_SIZE} />
        )}
      </section>
      <section className="card set-card">
        <CardHead title={130} sub={240} />
        <div className="table-wrap">
          <table className="rtable set-table">
            {th("Email", "Role", "Department", "Expires", ...(canWrite ? ["Actions"] : []))}
            <tbody>
              {(data?.invites ?? []).slice(0, INVITES_PAGE_SIZE).map((i) => (
                <tr key={i.id}>
                  <td data-label="Email"><div className="tt">{g(i.email)}</div></td>
                  <td data-label="Role">{g(role(i.role))}</td>
                  <td data-label="Department">{dept(i.dept)}</td>
                  <td data-label="Expires" className="num">
                    {g(when(i.expiresAt, today, tz, "date"))} {daysBetween(i.expiresAt, today) < 0 && <span className="st sk-ghost">Expired</span>}
                  </td>
                  {canWrite && (
                    <td data-label="Actions">
                      <span className="set-actions">
                        <span className="btn btn-outline set-sm sk-ghost-btn">Resend</span>
                        <span className="btn btn-outline set-sm sk-ghost-btn">Revoke</span>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(invites, INVITES_PAGE_SIZE) && (
          <PagerSkeleton rows={invites} size={INVITES_PAGE_SIZE} />
        )}
      </section>
    </>
  )
}

// The Owner column is always a read-only level badge; the other roles get a select when the user can write, a badge otherwise.
const LEVEL = { none: "None", read: "Read", write: "Write" } as const
function Roles({ canWrite, matrix }: { canWrite: boolean; matrix?: MatrixData }) {
  const roles = matrix?.roles ?? []
  return (
    <section className="card set-card">
      <CardHead title="Roles and permissions" sub="What each role can open and change, per module" />
      <p className="set-notice">
        <Sk w={18} h={18} r="circle" />
        <span>{g("Changes are audited")}</span>
      </p>
      <div className="table-wrap">
        <table className="rtable set-matrix">
          <thead>
            <tr>
              <th>{g("Module")}</th>
              {roles.map((r) => <th key={r.id}>{g(r.label)}</th>)}
            </tr>
          </thead>
          <tbody>
            {(matrix?.modules ?? []).map((m) => (
              <tr key={m.id}>
                <td data-label="Module"><span className="tt">{g(m.label)}</span></td>
                {roles.map((r) => (
                  <td key={r.id} data-label={r.label}>
                    {canWrite && r.id !== "owner" ? (
                      <div className="od-filters set-access"><Sk w={96} h={34.8} r="pill" /></div>
                    ) : (
                      <span className="set-level sk-ghost">{LEVEL[r.access[m.id]]}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Mirrors TemplatePanel for the first department (the global department filter defaults to all): the department tabs when
// there is more than one, then each section; enabled sections list their fields in the 2-column .set-fields grid (24px rows).
function Template({ depts, seed }: { depts: number; seed?: TemplateData }) {
  const current = seed?.departments[0]
  const list = current?.sections ?? []
  return (
    <section className="card set-card">
      <CardHead
        title="Report template"
        sub={current ? `${list.filter((x) => x.enabled).length} of ${list.length} sections enabled for ${current.dept}` : "No departments"}
        extra={depts > 1 && <Sk w={174} h={50} r="pill" className="sk-seg-hide" />}
      />
      <ul className="set-list">
        {list.map((sec, i) => (
          <li key={sec.id} className="set-sec">
            <div className="set-sec-head">
              <span className="set-switch-row">
                <Sk w={40} h={24} r="pill" />
                <span className="set-sec-title">{g(<><span className="num">{i + 1}.</span> {sec.title}</>)}</span>
              </span>
              <span className="set-sec-count num">{g(`${sec.fields.filter((f) => f.required).length} of ${sec.fields.length} fields required`)}</span>
            </div>
            {sec.enabled && (
              <ul className="set-fields">
                {sec.fields.map((f) => (
                  <li key={f.id}>
                    <span className="set-switch-row">
                      <Sk w={40} h={24} r="pill" />
                      <span>{g(f.label)}</span>
                      <span className="set-req">{g(f.required ? "Required" : "Optional")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

const clock = (deadline: string, minutesBefore: number) => {
  const [h, m] = deadline.split(":").map((n) => parseInt(n, 10))
  const t = (((h * 60 + m - minutesBefore) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

const DELIVERY_PILL: Record<string, string> = { delivered: "Delivered", sent: "Sent", queued: "Queued", failed: "Failed", skipped: "Skipped" }

function Notifications({ canWrite, data, deadline, tzLabel, today, log }: { canWrite: boolean; data?: NotificationsData; deadline: string; tzLabel: string; today: string; log: DeliveryRow[] }) {
  const next = data && deadline ? nextReminder(reminderSchedule({ today, deadline, timezone: "", tzLabel }, data), today) : undefined
  const chLabel = (id: string) => data?.channels.find((c) => c.id === id)?.label ?? id
  const intervals = [...(data?.intervals ?? [])].sort((a, b) => b - a)
  const spare = (data?.intervalOptions ?? []).filter((o) => !(data?.intervals ?? []).includes(o))
  return (
    <>
      <section className="card set-card">
        <CardHead title="Deadline reminders" sub={`Sent before the ${deadline ? formatTime(deadline) : ""} ${tzLabel} report deadline`} />
        <div className="set-chips">
          {intervals.map((m) => (
            <span key={m} className="set-chip sk-ghost-chip">
              <span className="num">{m} min</span>
              <span className="set-chip-at num">{formatTime(`${today.slice(0, 10)}T${clock(deadline, m)}`)} {tzLabel}</span>
              {canWrite && <Sk w={24} h={24} r="circle" />}
            </span>
          ))}
          {canWrite && spare.length > 0 && (
            <div className="od-filters set-add-interval">
              <Sk w={140} h={39.6} r="pill" />
            </div>
          )}
        </div>
        <p className="set-next num">
          {g(next ? `Next reminder: ${formatTime(next.reminder.atIso)} ${tzLabel}${next.tomorrow ? " tomorrow" : ""} (${next.reminder.channels.map(chLabel).join(", ")})` : "No reminders will be sent.")}
        </p>
        <div className="od-filters set-clock">
          <Sk w={200} h={40} r="pill" />
          <span className="tm">{g("Try the schedule: moves the mock clock, nothing is sent.")}</span>
        </div>
      </section>
      <section className="card set-card">
        <CardHead title="Channels" sub="Where each kind of notification is delivered" />
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>
                <th>{g("Event")}</th>
                {(data?.channels ?? []).map((c) => <th key={c.id}>{g(c.label)}</th>)}
              </tr>
            </thead>
            <tbody>
              {(data?.events ?? []).map((e) => (
                <tr key={e.id}>
                  <td data-label="Event"><span className="tt">{g(e.label)}</span></td>
                  {(data?.channels ?? []).map((c) => (
                    <td key={c.id} data-label={c.label}><Sk w={40} h={24} r="pill" lh={25.8} className="sk-sw" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card set-card">
        <CardHead title="Previews" sub="What lock screens and message previews may show" />
        <div className="set-switch-row set-locked">
          <Sk w={40} h={24} r="pill" />
          <span>{g("Hide sensitive details in previews")}</span>
          <span className="set-req">{g("Always on")}</span>
        </div>
        <p className="od-field-hint">{g("Names, amounts and payroll details never appear in notification previews. This protection cannot be turned off.")}</p>
      </section>
      <section className="card set-card">
        <CardHead title="Delivery log" sub="Every notification, channel by channel, with its delivery status" />
        <div className="od-filters">
          <Sk w={140} h={40} r="pill" />
          <Sk w={140} h={40} r="pill" />
        </div>
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>{["Time", "Event", "Recipient", "Channel", "Status", "Reason"].map((l) => <th key={l}>{g(l)}</th>)}</tr>
            </thead>
            <tbody>
              {log.slice(0, DELIVERY_PAGE_SIZE).map((r) => (
                <tr key={r.id}>
                  <td data-label="Time" className="num">{g(when(r.at, today, tzLabel))}</td>
                  <td data-label="Event"><span className="tt">{g(r.event)}</span></td>
                  <td data-label="Recipient">{g(r.recipient)}</td>
                  <td data-label="Channel">{g(chLabel(r.channel))}</td>
                  <td data-label="Status"><span className="st sk-ghost">{DELIVERY_PILL[r.status]}</span></td>
                  <td data-label="Reason">{r.reason ? g(r.reason) : <span className="tm">{g("None")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(log.length, DELIVERY_PAGE_SIZE) && <PagerSkeleton rows={log.length} size={DELIVERY_PAGE_SIZE} />}
      </section>
    </>
  )
}

function Integrations({
  canWrite,
  seed,
  today,
  tzLabel,
}: {
  canWrite: boolean
  seed: Integration[]
  today: string
  tzLabel: string
}) {
  const label = { connected: "Connected", not_connected: "Not connected", error: "Error" }
  return (
    <section className="card set-card">
      <CardHead title={110} sub={120} />
      <ul className="set-int-grid">
        {seed.map((i) => (
          <li key={i.id} className="set-int">
            <div className="set-int-top">
              <Sk w={44} h={44} r="circle" />
              <div className="set-int-name">
                <h3>{g(i.name)}</h3>
                <span className="st sk-ghost">{label[i.status]}</span>
              </div>
            </div>
            <p className="set-int-desc">{g(i.description)}</p>
            <p className="set-int-event">
              {g(<><b>Last event:</b> {i.lastEvent}{i.lastEventAt && <> · {when(i.lastEventAt, today, tzLabel)}</>}</>)}
            </p>
            <p className="set-int-policy">{g(i.policy)}</p>
            {canWrite && (
              <div className="set-int-foot">
                <span className={`btn ${i.status === "connected" ? "btn-outline" : "btn-primary"} sk-ghost-btn`}>{i.status === "connected" ? "Disconnect" : i.status === "error" ? "Reconnect" : "Connect"}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// `nameLines`: the tenant name wraps in the preview bar (21.75px lines) when it is long; browser-measured at 1440.
function Branding({
  canWrite,
  nameLines,
}: {
  canWrite: boolean
  nameLines: number
}) {
  return (
    <section className="card set-card">
      <CardHead title={90} sub={230} />
      <div className="set-brand">
        <div className="od-form set-form">
          <FieldSk label={100} hint={0} />
          <div className="od-field">
            <Sk w={40} h={11} lh={18.1} />
            <Sk h={76} r={20} />
            <Sk w={190} h={10} lh={17.4} style={{ marginTop: 6 }} />
          </div>
          <div className="od-field">
            <Sk w={90} h={11} lh={18.1} />
            <Sk h={44} r={14} />
          </div>
          {canWrite && <Foot w={138} />}
        </div>
        <div className="set-preview">
          <div className="set-preview-bar">
            <Sk w={42} h={42} r={14} />
            <span className="set-preview-name">
              {Array.from({ length: nameLines }, (_, i) => (
                <Sk key={i} w={i ? 90 : 160} h={15} lh={21.75} />
              ))}
            </span>
          </div>
          <Sk w={170} h={10} lh={17.4} style={{ marginTop: 6 }} />
        </div>
      </div>
    </section>
  )
}

function Privacy({ grants, canWrite, data }: { grants: number; canWrite: boolean; data?: SettingsSkeletonData }) {
  const today = data?.today ?? ""
  const tz = data?.tzLabel ?? ""
  const rows = supportRows(data?.grants ?? [], today)
  const waiting = rows.filter((r) => r.status === "requested").length
  return (
    <>
      <section className="card set-card">
        <CardHead title="Your data" sub="Export everything or ask for the workspace to be deleted" />
        <div className="set-data">
          <div>
            <h3>{g("Export all data")}</h3>
            <p>{g("Tasks, reports, files and people as a single archive, emailed when ready.")}</p>
          </div>
          <span className="btn btn-outline sk-ghost-btn">Export all data</span>
        </div>
        {canWrite && (
          <div className="set-data">
            <div>
              <h3>{g("Request deletion")}</h3>
              <p>{g("Permanently deletes the workspace and all its data after a 30 day grace period.")}</p>
            </div>
            <span className="btn btn-danger sk-ghost-btn">Request deletion</span>
          </div>
        )}
      </section>
      <section className="card set-card">
        <CardHead title="Support access" sub={`${rows.filter((r) => r.status === "granted").length} active${waiting ? ` · ${waiting} waiting for you` : ""} · support can only see your data while a grant is open`} button={canWrite ? 190 : 0} />
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>
                {["Who", "Reason", "Requested", "Expires", "Status", ...(canWrite ? ["Actions"] : [])].map((l) => <th key={l}>{g(l)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, GRANTS_PAGE_SIZE).map(({ row: r, status }) => {
                return (
                  <tr key={r.id}>
                    <td data-label="Who"><span className="tt">{g(r.requester)}</span></td>
                    <td data-label="Reason">{g(r.reason)}</td>
                    <td data-label="Requested" className="num">{g(when(r.requestedAt, today, tz))}</td>
                    <td data-label="Expires" className="num">{g(r.expiresAt ? when(r.expiresAt, today, tz) : "Not granted")}</td>
                    <td data-label="Status"><span className="st sk-ghost">{SUPPORT_STATUS[status].label}</span></td>
                    {canWrite && (
                      <td data-label="Actions">
                        {status === "requested" && (
                          <span className="set-actions">
                            <span className="btn btn-primary set-sm sk-ghost-btn">Approve</span>
                            <span className="btn btn-outline set-sm sk-ghost-btn">Decline</span>
                          </span>
                        )}
                        {status === "granted" && <span className="btn btn-outline set-sm sk-ghost-btn">Revoke</span>}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {needsPager(grants, GRANTS_PAGE_SIZE) && (
          <PagerSkeleton rows={grants} size={GRANTS_PAGE_SIZE} />
        )}
      </section>
    </>
  )
}

export function SettingsBodySkeleton({
  tab,
  counts,
  canWrite,
  billing,
}: {
  tab: SettingsTabId
  counts: SettingsCounts
  canWrite: boolean
  billing?: React.ReactNode
}) {
  switch (tab) {
    case "organisation":
      return <Organisation rules={counts.data?.weekendRules ?? []} tzLabel={counts.data?.tzLabel ?? ""} />
    case "departments":
      return (
        <Departments departments={counts.departments} canWrite={canWrite} seed={counts.data?.departments ?? []} />
      )
    case "users":
      return (
        <Users
          users={counts.users}
          invites={counts.invites}
          canWrite={canWrite}
          data={counts.data}
        />
      )
    case "roles":
      return (
        <Roles canWrite={canWrite} matrix={counts.data?.matrix} />
      )
    case "template":
      return (
        <Template depts={counts.templateDepts} seed={counts.data?.template} />
      )
    case "notifications":
      return (
        <Notifications canWrite={canWrite} data={counts.data?.notifications} deadline={counts.data?.deadline ?? ""} tzLabel={counts.data?.tzLabel ?? ""} today={counts.data?.today ?? ""} log={counts.data?.deliveryLog ?? []} />
      )
    case "integrations":
      return (
        <Integrations canWrite={canWrite} seed={counts.data?.integrations ?? []} today={counts.data?.today ?? ""} tzLabel={counts.data?.tzLabel ?? ""} />
      )
    case "branding":
      return <Branding canWrite={canWrite} nameLines={counts.brandNameLines} />
    case "billing":
      return <>{billing}</>
    case "privacy":
      return <Privacy grants={counts.grants} canWrite={canWrite} data={counts.data} />
  }
}

export function SettingsSkeleton({
  tab,
  counts,
  canWrite = true,
  billing,
}: {
  tab: SettingsTabId
  counts: SettingsCounts
  canWrite?: boolean
  billing?: React.ReactNode
}) {
  return (
    <SkGroup label="Loading settings" className="sk-page">
      <PageHeadSkeleton wrap={canWrite} />
      <div className="set-layout">
        <nav className="set-tabs" aria-hidden="true">
          {SETTINGS_TABS.map((t) => (
            <span key={t.id} className="set-tab">
              <Sk w={18} h={18} r={6} />
              <Sk w={70 + (t.label.length % 5) * 8} h={12} lh={19.6} />
            </span>
          ))}
        </nav>
        <div className="set-body">
          <SettingsBodySkeleton
            tab={tab}
            counts={counts}
            canWrite={canWrite}
            billing={billing}
          />
        </div>
      </div>
    </SkGroup>
  )
}
