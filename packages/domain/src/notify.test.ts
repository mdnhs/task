import { describe, expect, it } from "vitest"

import {
  channelStates, deliveries, designatedManagers, dueReminders, eventChannels, minutesLabel, missingReportAlerts, nextReminder, preview, reminderSchedule,
  type DueState, type OrgTiming, type TenantNotify, type UserNotifyPrefs,
} from "./notify"

const org: OrgTiming = { today: "2026-10-20T09:00:00", deadline: "17:30", timezone: "Europe/Dublin", tzLabel: "Irish time" }
const tenant: TenantNotify = {
  intervals: [60, 30, 10],
  intervalOptions: [120, 90, 60, 45, 30, 15, 10, 5],
  channels: [
    { id: "inapp", label: "In-app" },
    { id: "email", label: "Email", integration: "email" },
    { id: "whatsapp", label: "WhatsApp", integration: "whatsapp" },
  ],
  events: [
    { id: "deadline", label: "Reminder", userEvent: "report-reminder", on: { inapp: true, email: true, whatsapp: false } },
    { id: "attention", label: "Attention", on: { inapp: true, email: false, whatsapp: true } },
  ],
  hideSensitive: true,
  reminderEvent: "deadline",
  overdueEvent: "attention",
  overdueRoles: ["owner", "ops"],
  overdueAfter: [0, 30],
}
const user: UserNotifyPrefs = { prefs: { "report-reminder": { inapp: true, email: false } }, lead: "15" }
const state: DueState = {
  pending: ["Cleaning"],
  deadline: "17:30",
  managers: [{ id: "u1", name: "Manager One" }],
  submitters: [{ id: "u9", name: "Staff One" }],
}

describe("reminderSchedule", () => {
  it("derives times from the offsets and the deadline", () => {
    const s = reminderSchedule(org, tenant)
    expect(s.filter((r) => r.kind === "reminder").map((r) => r.at)).toEqual(["16:30", "17:00", "17:20"])
    expect(s.filter((r) => r.kind === "overdue").map((r) => r.at)).toEqual(["17:30", "18:00"])
    expect(s[0].channels).toEqual(["inapp", "email"])
    expect(s[0].atIso).toBe("2026-10-20T16:30")
  })
  it("follows a different deadline and different offsets", () => {
    const s = reminderSchedule({ ...org, deadline: "09:15" }, { ...tenant, intervals: [45, 15] })
    expect(s.filter((r) => r.kind === "reminder").map((r) => r.at)).toEqual(["08:30", "09:00"])
  })
  it("drops reminders that would fall before midnight", () => {
    const s = reminderSchedule({ ...org, deadline: "00:20" }, { ...tenant, intervals: [60, 10] })
    expect(s.filter((r) => r.kind === "reminder").map((r) => r.at)).toEqual(["00:10"])
  })
  it("drops overdue checkpoints past midnight", () => {
    const s = reminderSchedule({ ...org, deadline: "23:50" }, { ...tenant, overdueAfter: [0, 30] })
    expect(s.filter((r) => r.kind === "overdue").map((r) => r.at)).toEqual(["23:50"])
  })
  it("removes channels the user opted out of", () => {
    expect(reminderSchedule(org, tenant, user)[0].channels).toEqual(["inapp"])
  })
  it("adds the user's lead time only when the tenant allows it", () => {
    const s = reminderSchedule(org, tenant, user)
    const mine = s.find((r) => r.personal)
    expect(mine?.at).toBe("17:15")
    expect(reminderSchedule(org, tenant, { ...user, lead: "20" }).some((r) => r.personal)).toBe(false)
    expect(reminderSchedule(org, tenant, { ...user, lead: "30" }).some((r) => r.personal)).toBe(false)
  })
  it("returns nothing for reminders when no channel is on", () => {
    const off = { ...tenant, events: tenant.events.map((e) => (e.id === "deadline" ? { ...e, on: {} } : e)) }
    expect(reminderSchedule(org, off).filter((r) => r.kind === "reminder")).toEqual([])
  })
  it("gives stable ids per day", () => {
    expect(reminderSchedule(org, tenant).map((r) => r.id)).toEqual(reminderSchedule(org, tenant).map((r) => r.id))
    expect(reminderSchedule(org, tenant)[0].id).toBe("rem-2026-10-20-before-60")
  })
})

describe("eventChannels / nextReminder", () => {
  it("returns [] for an unknown event", () => expect(eventChannels(tenant, "nope")).toEqual([]))
  it("finds the next reminder and wraps to tomorrow", () => {
    const s = reminderSchedule(org, tenant)
    expect(nextReminder(s, "2026-10-20T09:00:00")?.reminder.at).toBe("16:30")
    expect(nextReminder(s, "2026-10-20T16:30:00")?.reminder.at).toBe("17:00")
    const late = nextReminder(s, "2026-10-20T17:25:00")
    expect(late?.tomorrow).toBe(true)
    expect(late?.reminder.at).toBe("16:30")
    expect(nextReminder([], "2026-10-20T09:00:00")).toBeUndefined()
  })
})

describe("dueReminders", () => {
  const s = reminderSchedule(org, tenant)
  it("fires nothing before the first time", () => expect(dueReminders(s, "2026-10-20T09:00:00", state)).toEqual([]))
  it("fires reminders whose time has passed, for submitters", () => {
    const due = dueReminders(s, "2026-10-20T17:05:00", state)
    expect(due.map((d) => d.at)).toEqual(["16:30", "17:00"])
    expect(due[0].audience).toBe("submitters")
    expect(due[0].recipients).toEqual(state.submitters)
    expect(due[0].message.title).toBe("Daily report due in 1 hour")
  })
  it("fires nothing when everything is submitted", () => {
    expect(dueReminders(s, "2026-10-20T17:05:00", { ...state, pending: [] })).toEqual([])
  })
  it("does not replay missed reminders after the deadline, but raises overdue alerts to managers", () => {
    const due = dueReminders(s, "2026-10-20T17:45:00", state)
    expect(due.map((d) => d.kind)).toEqual(["overdue"])
    expect(due[0].audience).toBe("managers")
    expect(due[0].recipients).toEqual(state.managers)
    expect(due[0].at).toBe("17:30")
  })
  it("adds the second overdue checkpoint later", () => {
    expect(dueReminders(s, "2026-10-20T18:05:00", state).map((d) => d.at)).toEqual(["17:30", "18:00"])
  })
  it("skips overdue alerts when no manager is designated", () => {
    expect(dueReminders(s, "2026-10-20T18:05:00", { ...state, managers: [] })).toEqual([])
  })
  it("ignores schedule entries from another day", () => {
    expect(dueReminders(s, "2026-10-21T17:05:00", state)).toEqual([])
  })
  it("is stable: the same call gives the same ids", () => {
    expect(dueReminders(s, "2026-10-20T17:05:00", state).map((d) => d.id)).toEqual(dueReminders(s, "2026-10-20T17:05:00", state).map((d) => d.id))
  })
  it("words several pending departments", () => {
    const due = dueReminders(s, "2026-10-20T17:05:00", { ...state, pending: ["Cleaning", "Security"] })
    expect(due[0].message.body).toBe("Cleaning, Security still need a report before 17:30.")
  })
})

describe("designatedManagers", () => {
  it("uses roles from data and skips deactivated people", () => {
    const users = [
      { id: "a", name: "A", role: "owner", status: "active" },
      { id: "b", name: "B", role: "ops", status: "deactivated" },
      { id: "c", name: "C", role: "employee", status: "active" },
      { id: "d", name: "D", role: "ops", status: "active" },
    ]
    expect(designatedManagers(users, tenant.overdueRoles)).toEqual([{ id: "a", name: "A" }, { id: "d", name: "D" }])
    expect(designatedManagers(users, ["employee"])).toEqual([{ id: "c", name: "C" }])
  })
})

describe("deliveries", () => {
  const states = channelStates(tenant, "deadline", { email: "connected", whatsapp: "not_connected" })
  it("builds channel states from tenant and integrations", () => {
    expect(states.map((c) => [c.id, c.enabled, c.connected])).toEqual([["inapp", true, true], ["email", true, true], ["whatsapp", false, false]])
  })
  it("delivers in-app, queues email, skips an off channel", () => {
    const d = deliveries({ id: "n1" }, states)
    expect(d.map((x) => x.status)).toEqual(["delivered", "queued", "skipped"])
    expect(d[2].reason).toBe("Channel is off for this event")
    expect(d[0].id).toBe("n1:inapp")
  })
  it("skips for user opt-out", () => {
    const d = deliveries({ id: "n1" }, states, { email: false })
    expect(d[1]).toMatchObject({ status: "skipped", reason: "User opted out" })
  })
  it("skips when the integration is not connected", () => {
    const d = deliveries({ id: "n2" }, channelStates(tenant, "attention", { email: "connected", whatsapp: "not_connected" }))
    expect(d.find((x) => x.channel === "whatsapp")).toMatchObject({ status: "skipped", reason: "Integration not connected" })
    expect(d.find((x) => x.channel === "email")?.reason).toBe("Channel is off for this event")
  })
  it("reports a failure with its reason and honours progress", () => {
    const d = deliveries({ id: "n3" }, states, undefined, { progress: "sent", failed: { email: "Mailbox full" } })
    expect(d[1]).toMatchObject({ status: "failed", reason: "Mailbox full" })
    expect(deliveries({ id: "n3" }, states, undefined, { progress: "sent" })[1].status).toBe("sent")
  })
  it("treats an error integration as not connected", () => {
    expect(channelStates(tenant, "deadline", { email: "error" })[1].connected).toBe(false)
  })
})

describe("preview", () => {
  const msg = { title: "Cleaning report is overdue", body: "No report from Cleaning.", generic: { title: "A daily report is overdue", body: "A report is missing." } }
  it("shows details when allowed", () => expect(preview(msg, false)).toEqual({ title: msg.title, body: msg.body }))
  it("hides sensitive details when the tenant setting is on", () => {
    expect(preview(msg, true)).toEqual({ title: "A daily report is overdue", body: "A report is missing." })
  })
  it("keeps a safe title when only the body is generic", () => {
    expect(preview({ title: "Daily report due in 30 min", body: "Cleaning needs a report.", generic: { body: "A report is due." } }, true)).toEqual({ title: "Daily report due in 30 min", body: "A report is due." })
  })
  it("falls back to wording with no details when nothing generic is given", () => {
    expect(preview({ title: "Payroll £1,200 for A. Person", body: "x" }, true)).toEqual({ title: "You have a new notification", body: "Open OpsDesk to see the details." })
  })
})

describe("minutesLabel", () => {
  it("formats", () => {
    expect(minutesLabel(10)).toBe("10 min")
    expect(minutesLabel(60)).toBe("1 hour")
    expect(minutesLabel(90)).toBe("1 h 30 min")
    expect(minutesLabel(120)).toBe("2 hours")
  })
})

describe("missingReportAlerts (FR-M1-30)", () => {
  const m = { key: "p-a:day:2026-10-19", member: { id: "p-a", name: "Ann" }, manager: { id: "p-m", name: "Max" }, shift: "Day patrol, Mon 19 Oct", due: "2026-10-19T16:00" }
  it("alerts member and manager once the due time has passed", () => {
    const out = missingReportAlerts([m], "2026-10-20T09:00:00", ["inapp"])
    expect(out.map((d) => [d.id, d.audience, d.recipients[0].id])).toEqual([
      ["shift-missing:p-a:day:2026-10-19:member", "submitters", "p-a"],
      ["shift-missing:p-a:day:2026-10-19:manager", "managers", "p-m"],
    ])
    expect(out[0].message.title).toBe("Your shift report is missing: Day patrol, Mon 19 Oct")
    expect(out[1].message.body).toBe("No report from Ann by 16:00.")
    expect(out[0].atIso).toBe("2026-10-19T16:00")
  })
  it("nothing before the due time; no manager alert without a manager", () => {
    expect(missingReportAlerts([m], "2026-10-19T15:59", ["inapp"])).toEqual([])
    expect(missingReportAlerts([{ ...m, manager: null }], "2026-10-19T16:00", ["inapp"]).map((d) => d.audience)).toEqual(["submitters"])
  })
})
