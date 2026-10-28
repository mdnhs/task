// Notification delivery engine (FR-NOT-02..05). Pure and server-safe: no React, no stores, no I/O.
// Nothing is sent: every function only decides what would be sent, to whom, on which channel and what the preview shows.
// All times are tenant wall-clock ("YYYY-MM-DDTHH:MM"), so no timezone maths is needed; `timezone` is kept for display only.

export type OrgTiming = { today: string; deadline: string; timezone: string; tzLabel: string }

/** A channel from the tenant settings. `integration` names the integration it needs; no integration means built in (in-app). */
export type NotifyChannel = { id: string; label: string; integration?: string }
export type NotifyEvent = { id: string; label: string; on: Record<string, boolean>; /** The matching event id in the per-user preferences, if users can opt out. */ userEvent?: string }

export type TenantNotify = {
  intervals: number[]
  intervalOptions: number[]
  channels: NotifyChannel[]
  events: NotifyEvent[]
  hideSensitive: boolean
  /** Event whose channels carry the deadline reminders. */
  reminderEvent: string
  /** Event whose channels carry the overdue alerts to managers. */
  overdueEvent: string
  /** Roles designated to receive overdue alerts. Read from the roles data, never named in code. */
  overdueRoles: string[]
  /** Minutes after the deadline at which an overdue alert is raised. */
  overdueAfter: number[]
}

export type UserNotifyPrefs = { prefs: Record<string, Record<string, boolean>>; lead: string }

export type ScheduledReminder = {
  id: string
  kind: "reminder" | "overdue"
  /** Minutes relative to the deadline: negative before, positive after. */
  offset: number
  /** Tenant clock "HH:MM". */
  at: string
  atIso: string
  channels: string[]
  /** True when this time exists only because of the user's own lead time (FR-ACC-03). */
  personal?: boolean
}

export type Recipient = { id: string; name: string }
export type PersonRow = { id: string; name: string; role: string; status: string }

export type NotifyMessage = {
  title: string
  body: string
  /** What may be shown when the tenant hides sensitive details (FR-NOT-04). */
  generic?: { title?: string; body: string }
}
export type DueItem = {
  id: string
  kind: "reminder" | "overdue"
  at: string
  atIso: string
  channels: string[]
  audience: "submitters" | "managers"
  recipients: Recipient[]
  event: string
  message: NotifyMessage
}

export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "skipped"
export type DeliveryChannel = { id: string; label: string; enabled: boolean; connected: boolean; instant?: boolean }
export type Delivery = { id: string; notificationId: string; channel: string; label: string; status: DeliveryStatus; reason?: string }

const pad = (n: number) => String(n).padStart(2, "0")
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10))
  return h * 60 + m
}
const toClock = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

/** "YYYY-MM-DDTHH:MM" for a date part plus a clock. */
export const clockAt = (iso: string, hhmm: string) => `${iso.slice(0, 10)}T${hhmm}`

/** "30 min", "1 hour", "1 h 30 min". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : h === 1 ? "1 hour" : `${h} hours`
}

/** Channel ids that carry an event: switched on by the tenant, minus any the user opted out of. */
export function eventChannels(tenant: TenantNotify, eventId: string, user?: UserNotifyPrefs): string[] {
  const ev = tenant.events.find((e) => e.id === eventId)
  if (!ev) return []
  const mine = ev.userEvent ? user?.prefs[ev.userEvent] : undefined
  return tenant.channels.filter((c) => ev.on[c.id] && mine?.[c.id] !== false).map((c) => c.id)
}

/**
 * Reminder times before the deadline (FR-NOT-02) plus the overdue checkpoints after it (FR-NOT-03), earliest first.
 * Offsets come from the tenant settings. A user's lead time adds a time only when the tenant lists it as an allowed option.
 */
export function reminderSchedule(org: OrgTiming, tenant: TenantNotify, user?: UserNotifyPrefs): ScheduledReminder[] {
  const date = org.today.slice(0, 10)
  const dl = toMin(org.deadline)
  const lead = user ? parseInt(user.lead, 10) : NaN
  const personal = Number.isFinite(lead) && lead > 0 && tenant.intervalOptions.includes(lead) && !tenant.intervals.includes(lead)
  const before = [...new Set([...tenant.intervals, ...(personal ? [lead] : [])])].filter((m) => m > 0)

  const out: ScheduledReminder[] = []
  const reminderChannels = eventChannels(tenant, tenant.reminderEvent, user)
  if (reminderChannels.length > 0) {
    for (const m of before) {
      if (dl - m < 0) continue
      out.push({ id: `rem-${date}-before-${m}`, kind: "reminder", offset: -m, at: toClock(dl - m), atIso: clockAt(date, toClock(dl - m)), channels: reminderChannels, ...(personal && m === lead ? { personal: true } : {}) })
    }
  }
  const overdueChannels = eventChannels(tenant, tenant.overdueEvent)
  if (overdueChannels.length > 0) {
    for (const m of new Set(tenant.overdueAfter.filter((x) => x >= 0))) {
      if (dl + m > 24 * 60 - 1) continue
      out.push({ id: `rem-${date}-overdue-${m}`, kind: "overdue", offset: m, at: toClock(dl + m), atIso: clockAt(date, toClock(dl + m)), channels: overdueChannels })
    }
  }
  return out.sort((a, b) => a.atIso.localeCompare(b.atIso))
}

/** The first reminder still ahead of `now`. `tomorrow` is true when today's are all past, so the first one repeats next day. */
export function nextReminder(schedule: ScheduledReminder[], now: string): { reminder: ScheduledReminder; tomorrow: boolean } | undefined {
  const before = schedule.filter((r) => r.kind === "reminder")
  const n = now.slice(0, 16)
  const ahead = before.find((r) => r.atIso > n)
  if (ahead) return { reminder: ahead, tomorrow: false }
  return before[0] ? { reminder: before[0], tomorrow: true } : undefined
}

/** People who receive overdue alerts: active users whose role is designated in the tenant settings. */
export function designatedManagers(users: PersonRow[], overdueRoles: string[]): Recipient[] {
  return users.filter((u) => u.status === "active" && overdueRoles.includes(u.role)).map((u) => ({ id: u.id, name: u.name }))
}

export type DueState = {
  /** Departments (or any units) whose report for today is not submitted yet. */
  pending: string[]
  managers?: Recipient[]
  /** Staff who still owe a report; reminders go to them. */
  submitters?: Recipient[]
  deadline: string
}

/**
 * What fires at tenant time `now` (FR-NOT-03). Reminders go to people who have not submitted, and only until the deadline
 * (a missed one is not replayed afterwards). Overdue alerts go to the designated managers once the deadline has passed
 * and a report is still missing. Everything with a time at or before `now` is returned; ids are stable per day, so the
 * caller can add them idempotently.
 */
export function dueReminders(schedule: ScheduledReminder[], now: string, state: DueState): DueItem[] {
  const n = now.slice(0, 16)
  if (state.pending.length === 0) return []
  const dl = clockAt(now, state.deadline)
  const list = state.pending.join(", ")
  const out: DueItem[] = []
  for (const s of schedule) {
    if (s.atIso > n || s.atIso.slice(0, 10) !== n.slice(0, 10)) continue
    if (s.kind === "reminder") {
      if (n > dl) continue
      out.push({
        id: s.id, kind: "reminder", at: s.at, atIso: s.atIso, channels: s.channels, audience: "submitters", recipients: state.submitters ?? [], event: "deadline",
        message: {
          title: `Daily report due in ${minutesLabel(-s.offset)}`,
          body: `${list} still ${state.pending.length === 1 ? "needs" : "need"} a report before ${state.deadline}.`,
          generic: { body: "A daily report is still due today." },
        },
      })
    } else {
      const managers = state.managers ?? []
      if (managers.length === 0) continue
      out.push({
        id: s.id, kind: "overdue", at: s.at, atIso: s.atIso, channels: s.channels, audience: "managers", recipients: managers, event: "attention",
        message: {
          title: `${list} ${state.pending.length === 1 ? "report is" : "reports are"} overdue`,
          body: `No report from ${list} by ${state.deadline}.`,
          generic: { title: "A daily report is overdue", body: "A daily report was not submitted by the deadline." },
        },
      })
    }
  }
  return out
}

/** Builds the per-channel state for one event from the tenant settings and the integrations (id → status). */
export function channelStates(tenant: TenantNotify, eventId: string, integrations: Record<string, string>): DeliveryChannel[] {
  const ev = tenant.events.find((e) => e.id === eventId)
  return tenant.channels.map((c) => ({
    id: c.id,
    label: c.label,
    enabled: !!ev?.on[c.id],
    connected: !c.integration || integrations[c.integration] === "connected",
    instant: !c.integration,
  }))
}

/**
 * One record per channel (FR-NOT-05). Skipped covers channel off for the event, user opted out, integration not connected.
 * In-app is delivered at once; others sit at `progress` (default queued) unless listed in `failed` (channel id → reason).
 * `prefs` is the user's choice for this event, channel id → on; a channel missing from it is not opted out.
 */
export function deliveries(
  n: { id: string },
  channels: DeliveryChannel[],
  prefs?: Record<string, boolean>,
  opts: { progress?: "queued" | "sent" | "delivered"; failed?: Record<string, string> } = {},
): Delivery[] {
  return channels.map((c) => {
    const base = { id: `${n.id}:${c.id}`, notificationId: n.id, channel: c.id, label: c.label }
    if (!c.enabled) return { ...base, status: "skipped", reason: "Channel is off for this event" }
    if (prefs?.[c.id] === false) return { ...base, status: "skipped", reason: "User opted out" }
    if (!c.connected) return { ...base, status: "skipped", reason: "Integration not connected" }
    const fail = opts.failed?.[c.id]
    if (fail) return { ...base, status: "failed", reason: fail }
    if (c.instant) return { ...base, status: "delivered" }
    return { ...base, status: opts.progress ?? "queued" }
  })
}

const GENERIC: NotifyMessage = { title: "You have a new notification", body: "Open OpsDesk to see the details." }

/** Title and body for a preview (lock screen, email subject, message). With `hideSensitive` only the generic wording is shown (FR-NOT-04). */
export function preview(n: NotifyMessage, hideSensitive: boolean): { title: string; body: string } {
  if (!hideSensitive) return { title: n.title, body: n.body }
  return { title: n.generic?.title ?? (n.generic ? n.title : GENERIC.title), body: n.generic?.body ?? GENERIC.body }
}

/** What the signed-in user's browser needs to raise in-app reminders (built on the server by lib/notify-data.ts). */
export type NotifyContext = {
  today: string
  deadline: string
  schedule: ScheduledReminder[]
  /** Departments with no submitted report for today. */
  pending: string[]
  /** This user must submit a report (gets reminders). */
  canSubmit: boolean
  /** This user holds a designated manager role (gets overdue alerts). */
  isManager: boolean
  hideSensitive: boolean
}
