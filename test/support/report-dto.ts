// Shift report, shift, dashboard and Today DTOs as the API returns them, for the web unit tests (B6 T6.7). Times follow the DST night of 24 to 25 Oct 2026 (Europe/Dublin):
// 22:00 IST (21:00Z) to 06:00 GMT (06:00Z) is NINE real hours, and the report is due 07:00 GMT.
export const TZ = "Europe/Dublin"
export const RID = "9b1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const PID = "7c1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const TEAM = "5e1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const TASK = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const FILE = "3a1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const ME = "usr_staff"
export const MGR = "usr_mgr"

export const reportDto = (over: Record<string, unknown> = {}) => ({
  id: RID, key: `${ME}:${PID}:2026-10-24`, userId: ME, patternId: PID, shiftName: "Night", team: "Security", date: "2026-10-24",
  start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00",
  startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z",
  status: "draft", state: "draft", version: 1, submissions: 0,
  items: [{ position: 0, taskId: TASK, ref: "TSK-1001", title: "Check fire exits", due: "2026-10-25T03:00", dueAt: "2026-10-25T03:00:00.000Z", status: "not_started", minutes: 0, note: "", taskStatus: "not_started", evidenceState: null }],
  summary: "", blockers: "", unplanned: [], extra: {}, attachments: [], submittedAt: null, reviewedAt: null, reviewedBy: null, comments: [], ...over,
})

export const inboxDto = (over: Record<string, unknown> = {}) => ({
  id: RID, key: `${ME}:${PID}:2026-10-24`, userId: ME, person: "Ann Byrne", patternId: PID, teamId: TEAM, shiftName: "Night", team: "Security", date: "2026-10-24",
  start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z",
  status: "submitted", state: "submitted", version: 2, submissions: 1, itemCount: 4, doneCount: 3, submittedAt: "2026-10-25T06:20:00.000Z", reviewedAt: null, reviewedBy: null, ...over,
})

export const shiftsDto = () => ({
  patterns: [{ id: PID, name: "Night", teamId: TEAM, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6], timeZone: null, version: 3 }],
  assignments: [{ id: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", userId: ME, patternId: PID, from: "2026-10-01", until: null }],
  members: [{ userId: ME, teams: [TEAM], managerId: MGR }],
  reporting: { dueAfterMinutes: 60, teamDefaults: { [TEAM]: true }, overrides: { [ME]: false } },
})

export const occurrenceDto = (over: Record<string, unknown> = {}) => ({
  userId: ME, patternId: PID, name: "Night", teamId: TEAM, shiftDate: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z",
  minutes: 540, endsNextDay: true, reportsOn: true, ...over,
})

const MEMBER = { key: `${ME}:${PID}:2026-10-24`, shiftName: "Night", shiftDate: "2026-10-24", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z", dueAt: "2026-10-25T07:00:00.000Z", state: "draft", reportId: null }
export const dashboardDto = (over: Record<string, unknown> = {}) => ({
  asOf: "2026-10-25T05:00:00.000Z", day: "2026-10-25",
  summary: { open: 42, overdue: 3, dueToday: 8, completedToday: 5, trend: [4, 6, 3, 7, 5, 2, 5], awaitingReview: 2, evidencePending: 4 },
  tasksClosed: { days: [{ date: "2026-10-24", count: 5, late: 1, topCloser: { userId: ME, name: "Ann Byrne", count: 2 } }, { date: "2026-10-25", count: 0, late: 0, topCloser: null }] },
  progress: { total: 60, percent: 40, mix: { not_started: 10, in_progress: 12, blocked: 2, submitted: 2, changes_requested: 1, completed: 30, cancelled: 3 } },
  reportDeadline: { member: null, team: { open: 3, missing: 1, awaitingReview: 2, nextDueAt: "2026-10-25T07:00:00.000Z", teams: [{ teamId: TEAM, team: "Security", open: 3, missing: 1, nextDueAt: "2026-10-25T07:00:00.000Z" }] } },
  attentionCount: 9, ...over,
})
export const memberDeadlineDto = (over: Record<string, unknown> = {}) => ({ ...MEMBER, ...over })

export const staffDto = (over: Record<string, unknown> = {}) => ({
  myTasks: { open: 3, overdue: 1, review: 0, returned: 1, items: [{ id: TASK, ref: "TSK-1001", title: "Check fire exits", priority: 2, status: "in_progress", dueAt: "2026-10-25T03:00:00.000Z", due: "2026-10-25T03:00:00", late: false }] },
  evidence: { awaitingReview: 0, returned: [{ ref: "TSK-1002", title: "Lock up", reason: "Photo is blurry" }] },
  comments: [{ id: RID, taskId: TASK, ref: "TSK-1001", taskTitle: "Check fire exits", authorId: MGR, author: "Mia Doyle", text: "Please add the photo", at: "2026-10-24T16:00:00.000Z" }],
  reportDeadline: { member: MEMBER, team: null }, ...over,
})

export const todayDto = (over: Record<string, unknown> = {}) => ({
  counts: { overdue: 1, dueToday: 2, high: 1, review: 0, reports: 1, blocked: 0 },
  workingDay: { key: "2026-10-24", startsAt: "2026-10-24T21:00:00.000Z", hasShift: true },
  order: [{ taskId: TASK, ref: "TSK-1001", title: "Check fire exits", priority: 3, status: "in_progress", dueAt: "2026-10-25T03:00:00.000Z", due: "2026-10-25T03:00:00", evidenceRequired: false, project: "Security", group: "overdue", reason: "overdue by 1 day; high priority" }],
  summary: { headline: "1 overdue", lines: [{ ref: null, text: "Today you have 1 overdue." }], spoken: "Today you have 1 overdue." },
  reports: 1, ...over,
})

export const templateDto = () => ({
  custom: true,
  departments: [{ dept: "Security", sections: [
    { id: "tasks", title: "Tasks in the shift", enabled: true, fields: [{ id: "time", label: "Time spent", required: true }, { id: "note", label: "Note on blocked", required: true }] },
    { id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Shift summary", required: true }] },
    { id: "handover", title: "Handover", enabled: true, fields: [{ id: "keys", label: "Keys returned", required: false }] },
  ] }],
})
