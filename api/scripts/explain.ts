// EXPLAIN pass for the load scenarios (B7 Task 17). LOCAL ONLY: a throwaway Postgres container, a local API and the users file of `npm run load:prepare`.
//   E2E_PG_ADMIN_URL=postgres://postgres:...@localhost:55432/opsdesk_e2e [E2E_PG_CONTAINER=opsdesk-e2e-postgres-1] [BASE_URL=http://localhost:3101] npm -w api exec -- tsx scripts/explain.ts
// It switches `auto_explain` on for the app role (EXPLAIN ANALYZE, BUFFERS of every statement, nested ones included) and waits 12 s, so the API's pool (idle timeout 10 s) opens fresh connections that load it. It calls each scenario endpoint once as the right persona
// (a warm-up call first), reads the plans back from the container log, switches auto_explain off again, and prints a Markdown table: per endpoint the statements, the
// slowest and the most expensive plan node, and every Seq Scan that read more than 1 000 rows.
// It is NOT read-only: the "report open" and "report draft save" steps create (or update) one shift-report row (the first employee of the users file, shift date today - 60) in the load tenant, and
// the API writes its usual audit/history rows for them. Use it on the throwaway load database only. auto_explain is switched off again at the end and on SIGINT/SIGTERM.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import pg from "pg"

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/
const ADMIN = process.env.E2E_PG_ADMIN_URL ?? ""
const BASE = (process.env.BASE_URL ?? "http://localhost:3101").replace(/\/$/, "")
const CONTAINER = process.env.E2E_PG_CONTAINER ?? "opsdesk-e2e-postgres-1"
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3100"
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(ADMIN) || !LOCAL.test(BASE)) {
  console.error("refused: the EXPLAIN pass only runs against a local database and a local API (E2E_PG_ADMIN_URL, BASE_URL)")
  process.exit(2)
}
const users = JSON.parse(readFileSync(fileURLToPath(new URL("../../load/.users.json", import.meta.url)), "utf8")) as { tenant: string; patternId: string; today: string; users: { role: string; cookie: string }[] }
const ops = users.users.find((u) => u.role === "ops")!
const emp = users.users.find((u) => u.role === "employee")!
const day = (n: number) => new Date(Date.parse(`${users.today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

type Step = { cold?: boolean; name: string; who: typeof ops; method: string; path: string | (() => string); body?: () => unknown }
let taskId = ""
let report: { id: string; version: number } | null = null
const STEPS: Step[] = [
  { cold: true, name: "dashboard (manager)", who: ops, method: "GET", path: "/v1/dashboard" },
  { cold: true, name: "dashboard (employee)", who: emp, method: "GET", path: "/v1/dashboard/staff" },
  { name: "tasks list", who: emp, method: "GET", path: "/v1/tasks?limit=50" },
  { name: "task detail", who: emp, method: "GET", path: () => `/v1/tasks/${taskId}` },
  { cold: true, name: "Today", who: emp, method: "GET", path: "/v1/today" },
  { name: "report open", who: emp, method: "POST", path: "/v1/shift-reports/open", body: () => ({ patternId: users.patternId, date: day(60) }) },
  { name: "report draft save", who: emp, method: "PUT", path: () => `/v1/shift-reports/${report!.id}/draft`, body: () => ({ version: report!.version, items: [], summary: "x", blockers: "", unplanned: [], extra: {} }) },
  { name: "search", who: emp, method: "GET", path: "/v1/search?q=load%20task&limit=10" },
  { name: "notifications", who: emp, method: "GET", path: "/v1/notifications?limit=20" },
]

async function call(s: Step): Promise<unknown> {
  const path = typeof s.path === "function" ? s.path() : s.path
  const res = await fetch(`${BASE}${path}`, {
    method: s.method,
    headers: { cookie: s.who.cookie, "x-tenant": users.tenant, ...(s.method !== "GET" ? { origin: ORIGIN, "content-type": "application/json" } : {}) },
    body: s.body ? JSON.stringify(s.body()) : undefined,
  })
  if (res.status >= 400) throw new Error(`${s.name}: HTTP ${res.status}`)
  const out = (await res.json()) as { version?: number }
  if (s.name === "report draft save" && report && out.version) report.version = out.version
  return out
}

type Plan = { ms: number; text: string; query: string; cost: number; seq: string[] }
function parse(log: string): Plan[] {
  const out: Plan[] = []
  for (const block of log.split(/LOG:\s+duration: /).slice(1)) {
    const ms = Number(block.split(" ")[0])
    const [head, ...rest] = block.split(/\bplan:\s*\n/)
    const body = rest.join("\n")
    const q = /Query Text: (.*)\n/.exec(body)
    const query = (q?.[1] ?? "").replace(/\s+/g, " ").trim()
    if (!query || /set_config|^(begin|commit|rollback)/i.test(query) || head === undefined) continue
    const costs = [...body.matchAll(/cost=[\d.]+\.\.([\d.]+)/g)].map((m) => Number(m[1]))
    const seq = [...body.matchAll(/Seq Scan on (\S+)[^\n]*actual time=[\d.]+\.\.[\d.]+ rows=(\d+) loops=(\d+)/g)].filter((m) => Number(m[2]) * Number(m[3]) > 1000).map((m) => `${m[1]} (${Number(m[2]) * Number(m[3])} rows)`)
    out.push({ ms, text: body, query, cost: Math.max(0, ...costs), seq })
  }
  return out
}

async function main(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN })
  await admin.connect()
  const set = async (on: boolean) => {
    for (const [k, v] of Object.entries({ session_preload_libraries: "auto_explain", "auto_explain.log_min_duration": "0", "auto_explain.log_analyze": "on", "auto_explain.log_buffers": "on", "auto_explain.log_nested_statements": "on" })) {
      await admin.query(on ? `alter role app_user set ${k} = '${v}'` : `alter role app_user reset ${k}`)
    }
  }
  const off = () => void set(false).catch(() => undefined).finally(() => process.exit(130))
  process.once("SIGINT", off)
  process.once("SIGTERM", off)
  const rows: { name: string; stmts: number; slow?: Plan; costly?: Plan; seq: string[] }[] = []
  try {
    await set(true)
    await new Promise((r) => setTimeout(r, 12_000))
    const list = (await (await fetch(`${BASE}/v1/tasks?limit=5`, { headers: { cookie: emp.cookie, "x-tenant": users.tenant } })).json()) as { items: { id: string }[] }
    taskId = list.items[0].id
    for (const s of STEPS) {
      if (s.name === "report draft save") report = (await call(STEPS[5])) as { id: string; version: number }
      if (!s.cold) await call(s).catch(() => undefined) // warm-up (plans, caches); not for the read models: their 30 s cache would hide the queries, so their one call is the first one
      await new Promise((r) => setTimeout(r, 300))
      const since = new Date(Date.now() - 50).toISOString()
      await call(s)
      await new Promise((r) => setTimeout(r, 400))
      const r = spawnSync("docker", ["logs", "--since", since, CONTAINER], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      const log = `${r.stdout}\n${r.stderr}` // Postgres logs to stderr
      const plans = parse(log)
      rows.push({ name: s.name, stmts: plans.length, slow: [...plans].sort((a, b) => b.ms - a.ms)[0], costly: [...plans].sort((a, b) => b.cost - a.cost)[0], seq: [...new Set(plans.flatMap((p) => p.seq))] })
    }
  } finally {
    await set(false).catch(() => undefined)
    await admin.end()
  }
  rows.sort((a, b) => (b.costly?.cost ?? 0) - (a.costly?.cost ?? 0))
  console.log("| endpoint | statements | slowest ms | highest plan cost | Seq Scan over 1 000 rows |\n|---|---|---|---|---|")
  for (const r of rows) console.log(`| ${r.name} | ${r.stmts} | ${r.slow?.ms.toFixed(2) ?? "-"} | ${r.costly?.cost.toFixed(0) ?? "-"} | ${r.seq.join(", ") || "none"} |`)
  console.log("\nTop three by cost:")
  for (const r of rows.slice(0, 3)) console.log(`\n### ${r.name}\n${r.costly?.query.slice(0, 400) ?? ""}\n\n${r.costly?.text.split("\n").filter((l) => !/Query Text|^\s*$/.test(l)).slice(0, 25).join("\n") ?? ""}`)
}

main().catch((e) => {
  console.error("explain failed:", (e as Error).message)
  process.exit(1)
})
