// Shared pieces of the k6 load test (B7 Task 17). Config comes from the environment:
//   BASE_URL     where the requests go. Default http://localhost:3100 (the web origin: the BFF forwards /v1/* to the API). LOCALHOST ONLY: anything else stops the run.
//   TARGET       "bff" (default: cookie `od-tenant` names the tenant, the Origin is BASE_URL) or "api" (the API port directly: header `X-Tenant`, Origin = ORIGIN, which must equal the API's APP_URL).
//   ORIGIN       Origin header on writes for TARGET=api (default http://localhost:3100).
//   METRICS_URL  optional, e.g. http://127.0.0.1:9464/metrics (the API's internal metrics port): adds the `db_pool_waiting` series and its threshold.
// The users file (load/.users.json) comes from `npm run load:prepare`.
import http from "k6/http"
import { check, sleep } from "k6"
import { Counter, Trend } from "k6/metrics"
import { SharedArray } from "k6/data"

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/
export const BASE_URL = (__ENV.BASE_URL || "http://localhost:3100").replace(/\/$/, "")
export const TARGET = __ENV.TARGET || "bff"
export const ORIGIN = (__ENV.ORIGIN || "http://localhost:3100").replace(/\/$/, "")
export const METRICS_URL = __ENV.METRICS_URL || ""
for (const u of [BASE_URL, METRICS_URL]) {
  if (u && !LOCAL.test(u)) throw new Error("refused: the load test only runs against localhost")
}
if (TARGET !== "bff" && TARGET !== "api") throw new Error("TARGET must be bff or api")

const file = new SharedArray("users", () => [JSON.parse(open("../.users.json"))])[0]
export const TENANT = file.tenant
export const PATTERN_ID = file.patternId
export const TODAY = file.today
export const USERS = file.users

export const rateLimited = new Counter("rate_limited")
export const dbPoolWaiting = new Trend("db_pool_waiting")

/** The thresholds, one source of truth shared with load/README.md. db_pool_waiting is only asserted when the metrics port is given (no samples otherwise). */
export function thresholds() {
  const t = JSON.parse(open("./thresholds.json"))
  if (METRICS_URL) t.db_pool_waiting = ["p(95)<1"]
  return t
}

export const userFor = (vu) => USERS[(vu - 1) % USERS.length]

function headersFor(user, write, json) {
  const h = { cookie: TARGET === "bff" ? `${user.cookie}; od-tenant=${TENANT}` : user.cookie }
  if (TARGET === "api") h["x-tenant"] = TENANT
  if (write) h.origin = TARGET === "bff" ? BASE_URL : ORIGIN
  if (json) h["content-type"] = "application/json"
  return h
}

/** One request. `kind` is "read" or "write", `name` the scenario step: both are tags the thresholds select on. Counts 429s. Returns the response. */
export function req(method, path, user, kind, name, body) {
  const write = method !== "GET"
  const res = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: headersFor(user, write, body !== undefined),
    tags: { kind, name },
    redirects: 0,
  })
  if (res.status === 429) rateLimited.add(1)
  return res
}

export const ok = (res, name, codes = [200]) => check(res, { [`${name} ${codes.join("/")}`]: (r) => codes.includes(r.status) })

export function json(res) {
  try {
    return res.json()
  } catch {
    return null
  }
}

/** One scrape of the API's internal metrics port every 5 s (the `pool` scenario). */
export function scrapePool() {
  sleep(5)
  const res = http.get(METRICS_URL, { tags: { kind: "internal", name: "metrics" } })
  const m = /^db_pool_waiting(?:\{[^}]*\})? ([0-9.]+)$/m.exec(res.body || "")
  if (m) dbPoolWaiting.add(Number(m[1]))
}

/** yyyy-mm-dd of `today` minus n days (the shift dates a VU reports on). */
export function daysBefore(n) {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
