// The 250-user scenario (NFR-08): ramp 2 min, hold 10 min, ramp down 1 min. Each iteration picks ONE action by weight, then thinks 1 to 5 s.
//   dashboard 20 | tasks list 25 | task detail 15 | Today 15 | shift report draft save 10 | report submit 5 | search 5 | notifications 5
// Thresholds: load/k6/thresholds.json (documented in load/README.md).
import { sleep } from "k6"
import { ok, json, req, userFor, USERS, thresholds, scrapePool, METRICS_URL, PATTERN_ID, daysBefore } from "./lib.js"

const MIX = [
  ["dashboard", 20],
  ["tasks_list", 25],
  ["task_detail", 15],
  ["today", 15],
  ["report_draft", 10],
  ["report_submit", 5],
  ["search", 5],
  ["notifications", 5],
]
const TOTAL = MIX.reduce((n, [, w]) => n + w, 0)
const pick = () => {
  let r = Math.random() * TOTAL
  for (const [name, w] of MIX) if ((r -= w) < 0) return name
  return MIX[0][0]
}

export function makeOptions(stages) {
  const scenarios = { mix: { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "30s", exec: "mix" } }
  if (METRICS_URL) scenarios.pool = { executor: "constant-vus", vus: 1, duration: stages.reduce((n, s) => n + seconds(s.duration), 0) + "s", exec: "pool" }
  return { scenarios, thresholds: thresholds(), summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"] }
}
const seconds = (d) => (d.endsWith("m") ? Number(d.slice(0, -1)) * 60 : Number(d.replace("s", "")))

export const options = makeOptions([
  { duration: "2m", target: 250 },
  { duration: "10m", target: 250 },
  { duration: "1m", target: 0 },
])

// per-VU state (module scope is per VU)
let taskIds = []
let draft = null // { id, version } of yesterday's report
let submits = 0 // reports submitted by this VU so far: each one uses an older shift date

function tasksList(user) {
  const res = req("GET", "/v1/tasks?limit=50", user, "read", "tasks_list")
  ok(res, "tasks list")
  const body = json(res)
  if (body && body.items) taskIds = body.items.map((t) => t.id)
}

function openReport(user, date) {
  const res = req("POST", "/v1/shift-reports/open", user, "write", "report_open", { patternId: PATTERN_ID, date })
  ok(res, "report open", [200, 201])
  return json(res)
}

const ACTIONS = {
  dashboard(user) {
    const path = user.role === "employee" ? "/v1/dashboard/staff" : "/v1/dashboard"
    ok(req("GET", path, user, "read", "dashboard"), "dashboard")
  },
  tasks_list: tasksList,
  task_detail(user) {
    if (taskIds.length === 0) tasksList(user)
    if (taskIds.length === 0) return
    ok(req("GET", `/v1/tasks/${taskIds[Math.floor(Math.random() * taskIds.length)]}`, user, "read", "task_detail"), "task detail")
  },
  today(user) {
    ok(req("GET", "/v1/today", user, "read", "today"), "today")
  },
  report_draft(user) {
    if (!draft) {
      const r = openReport(user, daysBefore(1))
      if (!r) return
      draft = { id: r.id, version: r.version }
    }
    const res = req("PUT", `/v1/shift-reports/${draft.id}/draft`, user, "write", "report_draft", { version: draft.version, items: [], summary: "Quiet shift.", blockers: "", unplanned: [], extra: {} })
    if (ok(res, "report draft")) draft.version = json(res).version
    else draft = null
  },
  report_submit(user) {
    submits += 1
    const r = openReport(user, daysBefore(1 + submits)) // yesterday is the draft's; each submit takes an older, never-used shift date (the prepared pattern runs every day for 90 days)
    if (!r) return
    // every task row of the shift is marked done (a row left as it is blocks the submit with 422)
    const items = (r.items || []).filter((i) => i.taskId).map((i) => ({ taskId: i.taskId, status: "done", minutes: 30, note: "" }))
    const saved = req("PUT", `/v1/shift-reports/${r.id}/draft`, user, "write", "report_draft", { version: r.version, items, summary: "Quiet shift.", blockers: "", unplanned: [], extra: {} })
    if (!ok(saved, "report draft before submit")) return
    const res = req("POST", `/v1/shift-reports/${r.id}/submit`, user, "write", "report_submit", { version: json(saved).version, requestId: uuid() })
    ok(res, "report submit")
  },
  search(user) {
    const q = ["load user", "load task", "tsk-1", "user 00"][Math.floor(Math.random() * 4)]
    ok(req("GET", `/v1/search?q=${encodeURIComponent(q)}&limit=10`, user, "read", "search"), "search")
  },
  notifications(user) {
    ok(req("GET", "/v1/notifications?limit=20", user, "read", "notifications"), "notifications")
  },
}

function uuid() {
  const h = () => Math.floor(Math.random() * 16).toString(16)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => (c === "x" ? h() : ((Math.random() * 4) | 8).toString(16)))
}

export function mix() {
  if (__VU > USERS.length) return sleep(5) // more VUs than users (ramping can overshoot by one): never two VUs on one user, their report versions would conflict
  const user = userFor(__VU)
  ACTIONS[pick()](user)
  sleep(1 + Math.random() * 4)
}
export { scrapePool as pool }
export default mix
