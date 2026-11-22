import { PageHeadSkeleton } from "@/components/page-head"
import {
  PagerSkeleton,
  needsPager,
  pageRows,
} from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import {
  DEPARTMENTS_PAGE_SIZE,
  DELIVERY_PAGE_SIZE,
  DEVICES_PAGE_SIZE,
  REQUESTS_PAGE_SIZE,
  INVITES_PAGE_SIZE,
  USERS_PAGE_SIZE,
} from "../constants"
import { nextReminder, reminderSchedule } from "@/lib/notify"
import { daysBetween, formatDate, formatDue, formatTime } from "@/lib/dates"
import { SUPPORT_STATUS, supportRows, type SupportAccess } from "@/lib/support-access"
import { DEVICE_TYPES, DEVICE_FEATURES, allowFor, describePolicy } from "@/lib/devices"
import type { Device, DevicePolicy } from "@/lib/devices"
import { describeMfaPolicy } from "@/lib/mfa"
import { enforcementOf, enforcementText } from "@/lib/mfa-enforcement"
import type { MfaPolicy } from "@/lib/mfa"
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
  devices: number
  requests: number
  /** The member may read the data-request list (owner or admin). Defaults to true. */
  canRequests?: boolean
  /** Privacy actions (support grant, data export, deletion) are Tenant Owner only (FR-SET-08). Defaults to canWrite. */
  owner?: boolean
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
  devices?: Device[]
  devicePolicies?: DevicePolicy[]
  mfaPolicy?: MfaPolicy
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
    {button ? <Sk w={button} h={48} r={14} /> : null}
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
    <Sk h={48} r={14} />
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
    <Sk w={w} h={48} r={14} />
  </div>
)

// FormSection (ui-rules.md rule 32): icon chip + title, then its fields. An empty .fs-sec-i keeps the chip's tint and size.
const SecSk = ({ title, action, children }: { title: string; action?: string; children?: React.ReactNode }) => (
  <section className="fs-sec">
    <h3 className="fs-sec-h">
      <span className="fs-sec-i" aria-hidden="true" />
      {g(title)}
      {action && <span className="fs-act">{g(action)}</span>}
    </h3>
    {children}
  </section>
)

// .rp-day chip choices (ghost labels so long ones wrap like the loaded chips).
const ChipsSk = ({ label, chips }: { label: string; chips: string[] }) => (
  <div className="od-field">
    <span className="fs-label">{g(label)}</span>
    <div className="er-types">
      {chips.map((c) => <span key={c} className="rp-day sk-pill">{g(c)}</span>)}
    </div>
  </div>
)

// Organisation: two columns (Company: name, workspace ID; Daily report: timezone, deadline). Static. Intended heights from the real classes; T6.9 measures them.
function Organisation() {
  return (
    <section className="card set-card">
      <CardHead title={120} sub={230} />
      <div className="od-form set-form">
        <div className="od-form-cols">
          <div className="od-form-col">
            <SecSk title="Company">
              <FieldSk label="Company name" hint={0} required />
              <FieldSk label="Workspace ID" hint={0} />
            </SecSk>
            <SecSk title="Security">
              <FieldSk label="Session timeout" hint="Idle time before sign-out. Set by the platform for now." />
            </SecSk>
          </div>
          <div className="od-form-col">
            <SecSk title="Daily report">
              <FieldSk label="Timezone" hint={0} />
              <FieldSk label="Report deadline" hint={0} />
            </SecSk>
          </div>
        </div>
        <Foot />
      </div>
    </section>
  )
}

function Departments({ departments, canWrite }: { departments: number; canWrite: boolean }) {
  return (
    <section className="card set-card">
      <CardHead title={120} sub={90} button={canWrite ? 190 : 0} />
      <ul className="set-list">
        {Array.from({ length: pageRows(departments, DEPARTMENTS_PAGE_SIZE) }, (_, i) => (
          <li key={i} className="set-dep">
            <div className="set-dep-main">
              <span className="set-dep-top"><Sk w={110} h={14} lh={22} /></span>
              <span className="set-dep-line"><Sk w={70} h={11} lh={20} /></span>
            </div>
            {canWrite && (
              <span className="set-actions">
                <Sk w={88} h={48} r={14} />
                <Sk w={84} h={48} r={14} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {needsPager(departments, DEPARTMENTS_PAGE_SIZE) && <PagerSkeleton rows={departments} size={DEPARTMENTS_PAGE_SIZE} />}
    </section>
  )
}

// Users: role filter + search, table (User, Role select when the member can write, Department, [WhatsApp on the demo flag], Status, Last active, Deactivate when the member can write) and the pending invites table (Email, Role, Expires, Resend and Revoke).
function Users({ users, invites, canWrite, wa = false }: { users: number; invites: number; canWrite: boolean; wa?: boolean }) {
  const head = (ws: number[]) => <thead><tr>{ws.map((w, i) => <th key={i}><Sk w={w} h={10} lh={15.94} /></th>)}</tr></thead>
  return (
    <>
      <section className="card set-card">
        <CardHead title={70} sub={190} button={canWrite ? 160 : 0} />
        <div className="od-filters">
          <Sk w={140} h={48} r="pill" />
          <Sk h={48} r="pill" className="sk-fsearch" />
        </div>
        <div className="table-wrap">
          <table className="rtable set-table">
            {head([36, 36, 70, ...(wa ? [60] : []), 44, 70, ...(canWrite ? [0] : [])])}
            <tbody>
              {Array.from({ length: pageRows(users, USERS_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="User"><Sk w={120} h={13} lh={19} /><Sk w={160} h={10} lh={16} /></td>
                  <td data-label="Role">{canWrite ? <div className="od-filters set-access"><Sk w={140} h={48} r="pill" /></div> : <Sk w={90} h={13} lh={19} />}</td>
                  {/* Browser-measured (B8 Task 24, admin on the demo tenant): rows 71 at 1568 (the role select sets it); stacked at 390 the cells are dep tag 37.9, status pill 45.4,
                      "Never" 32.7 and the Deactivate button 64 high */}
                  <td data-label="Department"><Sk w={80} h={13} lh={21.9} /></td>
                  {wa && <td data-label="WhatsApp"><span className="wa-user-cell"><Sk w={92} h={29.4} r={8} />{canWrite && <Sk w={57} h={48} r={12} />}</span></td>}
                  <td data-label="Status"><Sk w={64} h={24} lh={29.4} r="pill" /></td>
                  <td data-label="Last active"><Sk w={60} h={11} lh={16.7} /></td>
                  {canWrite && <td data-label="Actions"><Sk w={98} h={48} r={14} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(users, USERS_PAGE_SIZE) && <PagerSkeleton rows={users} size={USERS_PAGE_SIZE} />}
      </section>
      <section className="card set-card">
        <CardHead title={130} sub={240} />
        <div className="table-wrap">
          <table className="rtable set-table">
            {head([36, 36, 50, ...(canWrite ? [54] : [])])}
            <tbody>
              {Array.from({ length: pageRows(invites, INVITES_PAGE_SIZE) }, (_, i) => (
                <tr key={i}>
                  <td data-label="Email"><Sk w={150} h={13} lh={19} /></td>
                  <td data-label="Role"><Sk w={90} h={13} lh={19} /></td>
                  <td data-label="Expires"><Sk w={90} h={13} lh={19} /></td>
                  {canWrite && <td data-label="Actions"><span className="set-actions"><Sk w={81} h={38} r={12} /><Sk w={76} h={38} r={12} /></span></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {needsPager(invites, INVITES_PAGE_SIZE) && <PagerSkeleton rows={invites} size={INVITES_PAGE_SIZE} />}
      </section>
    </>
  )
}

// The Owner column is always a read-only level badge; the other roles get a select when the user can write, a badge otherwise.
const LEVEL = { none: "None", read: "Read", write: "Write" } as const
function Roles({ canWrite, roles, modules }: { canWrite: boolean; roles: number; modules: number }) {
  return (
    <section className="card set-card">
      <CardHead title="Roles and permissions" sub="What each role can open and change, per module" button={canWrite ? 128 : undefined} />
      <p className="set-notice">
        <Sk w={18} h={18} r="circle" />
        <span>{g("Changes are audited. Built-in roles are fixed: copy one to edit it.")}</span>
      </p>
      <div className="table-wrap">
        <table className="rtable set-matrix">
          <thead>
            <tr>
              <th><Sk w={50} h={10} lh={15.94} /></th>
              {Array.from({ length: roles }, (_, i) => <th key={i}><Sk w={70} h={10} lh={15.94} /></th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: modules }, (_, m) => (
              <tr key={m}>
                <td data-label="Module"><Sk w={100} h={13} lh={19} /></td>
                {Array.from({ length: roles }, (_, r) => (
                  <td key={r}>{canWrite && r > 0 ? <div className="od-filters set-access"><Sk w={96} h={48} r="pill" /></div> : <Sk w={44} h={26} r={8} />}</td>
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
        extra={depts > 1 && <Sk w={174} h={48} r="pill" className="sk-seg-hide" />}
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
              <Sk w={140} h={48} r="pill" />
            </div>
          )}
        </div>
        <p className="set-next num">
          {g(next ? `Next reminder: ${formatTime(next.reminder.atIso)} ${tzLabel}${next.tomorrow ? " tomorrow" : ""} (${next.reminder.channels.map(chLabel).join(", ")})` : "No reminders will be sent.")}
        </p>
        <div className="od-filters set-clock">
          <Sk w={200} h={48} r="pill" />
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
          <Sk w={140} h={48} r="pill" />
          <Sk w={140} h={48} r="pill" />
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

// One card with Google Drive, the only integration the API has (not connected, the typical new company).
function Integrations({ canWrite, extra }: { canWrite: boolean; extra?: React.ReactNode }) {
  return (
    <section className="card set-card">
      <CardHead title={110} sub={120} />
      <ul className="set-int-grid">
        <li className="set-int">
          <div className="set-int-top">
            <Sk w={44} h={44} r="circle" />
            <div className="set-int-name"><Sk w={100} h={16} lh={22} /><Sk w={96} h={29.4} r={8} /></div>
          </div>
          <p className="set-int-desc"><span className="sk-ghost">Opens Drive files from tasks and reports. Read-only.</span></p>
          <p className="set-int-event"><span className="sk-ghost">Last event: Never connected</span></p>
          <p className="set-int-policy"><span className="sk-ghost">Drive links only open on devices your policy allows.</span></p>
          {canWrite && <div className="set-int-foot"><Sk w={110} h={48} r={14} /></div>}
        </li>
        {extra}
      </ul>
    </section>
  )
}

// Device access card under Integrations (DevicePolicyCard): one row per feature, a select when the user can write.
function DevicePolicies({ canWrite, policies }: { canWrite: boolean; policies: DevicePolicy[] }) {
  return (
    <section className="card set-card">
      <CardHead title="Device access" sub="Where each feature can be used. Register devices on the Devices tab." />
      <ul className="set-list">
        {DEVICE_FEATURES.map((f) => (
          <li key={f.value} className="dev-policy">
            <div className="dev-policy-text">
              <b className="sk-ghost" style={{ alignSelf: "flex-start" }}>{f.label}</b>
              <span>{g(describePolicy({ feature: f.value, allow: allowFor(f.value, policies) }))}</span>
            </div>
            {/* FilterSeg: Trusted PCs / Any device / Nowhere (browser-measured 297 wide) */}
            {canWrite && <div className="od-filters"><Sk w={297} h={48} r="pill" style={{ maxWidth: "100%" }} /></div>}
          </li>
        ))}
      </ul>
    </section>
  )
}

// Two-step rule card under Roles (MfaPolicyCard). The rule is a FilterSeg (Optional / Everyone / Chosen roles), browser-measured.
const MFA_SEG_W = 292
const MFA_HOW_W = 178 // measured in the browser (Soft prompt | Strict)
function MfaPolicySk({ canWrite, policy, roleLabels }: { canWrite: boolean; policy: MfaPolicy; roleLabels: Record<string, string> }) {
  return (
    <section className="card set-card">
      <CardHead title="Two-step verification" sub={describeMfaPolicy(policy, roleLabels)} extra={canWrite ? <div className="od-filters"><Sk w={MFA_SEG_W} h={48} r="pill" style={{ maxWidth: "100%" }} /></div> : null} />
      {policy.mode !== "off" && (
        <div className="mfa-enf">
          <p className="mfa-enf-t">{g(enforcementText(enforcementOf(policy)))}</p>
          {canWrite && <Sk w={MFA_HOW_W} h={48} r="pill" style={{ maxWidth: "100%" }} />}
        </div>
      )}
      {policy.mode === "roles" && (
        <div className="dev-roles">
          {Object.entries(roleLabels).map(([id, text]) => (
            <label key={id} className="set-switch-row"><Sk w={40} h={24} r="pill" />{g(text)}</label>
          ))}
        </div>
      )}
    </section>
  )
}

// Mirrors DevicesPanel: head with the add button, then one row per device (switch + remove when the user can write).
// Devices: head with the add button, then rows (icon, label and owner pill, trusted switch, Enrolment code and Remove when the member can write).
function Devices({ canWrite, devices }: { canWrite: boolean; devices: number }) {
  return (
    <section className="card set-card">
      <CardHead title="Registered devices" sub={90} button={canWrite ? 138 : undefined} />
      <ul className="set-list">
        {Array.from({ length: pageRows(devices, DEVICES_PAGE_SIZE) }, (_, i) => (
          <li key={i} className="dev-row">
            <Sk w={40} h={40} r={12} />
            <div className="dev-main">
              <span className="dev-top"><Sk w={120} h={14} lh={22} /><Sk w={80} h={29.4} r={8} /></span>
              <Sk w={220} h={10} lh={16} />
            </div>
            <label className="dev-trust"><Sk w={40} h={24} r="pill" />{g("Trusted")}</label>
            {canWrite && <span className="set-actions"><Sk w={140} h={38} r={12} /><Sk w={81} h={38} r={12} /></span>}
          </li>
        ))}
      </ul>
      {needsPager(devices, DEVICES_PAGE_SIZE) && <PagerSkeleton rows={devices} size={DEVICES_PAGE_SIZE} />}
    </section>
  )
}

// Appearance pill widths (Sharp/Soft/Round, Small/Default/Large, Compact/Comfortable/Spacious) and legend widths, browser-measured.
const APPEAR_PILLS = [[66, 56, 70], [64, 77, 66], [88, 112, 89]]
const LEGEND_W = [55, 62, 53]

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
          <SecSk title="Colour">
            <div className="od-field">
              <Sk w={90} h={11} lh={18.1} />
              <Sk h={48} r={14} />
            </div>
          </SecSk>
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

// Privacy: "Your data" (export my data, support access link) and, for owners and admins, the data requests table (Person, Kind, Due, Status).
function Privacy({ requests, canRequests, canWrite }: { requests: number; canRequests: boolean; canWrite: boolean }) {
  return (
    <>
      <section className="card set-card">
        <CardHead title="Your data" sub="Ask for a copy of your own data" />
        <div className="set-data">
          <div>
            <h3>{g("Export my data")}</h3>
            <p>{g("Everything we hold about you, as one file.")}</p>
          </div>
          <span className="btn btn-outline sk-ghost-btn">Export my data</span>
        </div>
        <div className="set-data">
          <div>
            <h3>{g("Support access")}</h3>
            <p>{g("Who from OpsDesk support can see your workspace, and for how long.")}</p>
          </div>
          <span className="btn btn-outline sk-ghost-btn">View</span>
        </div>
      </section>
      {canRequests && (
        <section className="card set-card">
          <CardHead title={120} sub={190} button={canWrite ? 130 : 0} />
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead><tr>{[40, 30, 30, 40].map((w, i) => <th key={i}><Sk w={w} h={10} lh={15.94} /></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: pageRows(requests, REQUESTS_PAGE_SIZE) }, (_, i) => (
                  <tr key={i}>
                    <td data-label="Person"><Sk w={110} h={13} lh={19} /></td>
                    <td data-label="Kind"><Sk w={60} h={13} lh={19} /></td>
                    <td data-label="Due"><Sk w={90} h={13} lh={19} /></td>
                    <td data-label="Status"><Sk w={70} h={29.4} r={8} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

export function SettingsBodySkeleton({
  tab,
  counts,
  canWrite,
  billing,
  extras,
}: {
  tab: SettingsTabId
  counts: SettingsCounts
  canWrite: boolean
  billing?: React.ReactNode
  /** More cards the route composes in (a feature does not import another feature): the mock WhatsApp card of the Integrations grid. */
  extras?: { integrations?: React.ReactNode; usersWhatsApp?: boolean }
}) {
  switch (tab) {
    case "organisation":
      return <Organisation />
    case "departments":
      return <Departments departments={counts.departments} canWrite={canWrite} />
    case "users":
      return (
        <Users users={counts.users} invites={counts.invites} canWrite={canWrite} wa={extras?.usersWhatsApp} />
      )
    case "roles":
      return (
        <>
          <Roles canWrite={canWrite} roles={counts.roles} modules={counts.modules} />
          <MfaPolicySk canWrite={canWrite} policy={counts.data?.mfaPolicy ?? { mode: "off", roles: [] }} roleLabels={counts.data?.roleLabels ?? {}} />
        </>
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
        <>
          <Integrations canWrite={canWrite} extra={extras?.integrations} />
          <DevicePolicies canWrite={canWrite} policies={counts.data?.devicePolicies ?? []} />
        </>
      )
    case "devices":
      return <Devices canWrite={canWrite} devices={counts.devices} />
    case "branding":
      return <Branding canWrite={canWrite} nameLines={counts.brandNameLines} />
    case "billing":
      return <>{billing}</>
    case "privacy":
      return <Privacy requests={counts.requests} canRequests={counts.canRequests ?? true} canWrite={canWrite && (counts.owner ?? true)} />
  }
}

export function SettingsSkeleton({
  tab,
  counts,
  canWrite = true,
  billing,
  extras,
}: {
  tab: SettingsTabId
  counts: SettingsCounts
  canWrite?: boolean
  billing?: React.ReactNode
  extras?: { integrations?: React.ReactNode; usersWhatsApp?: boolean }
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
            extras={extras}
          />
        </div>
      </div>
    </SkGroup>
  )
}
