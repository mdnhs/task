#!/usr/bin/env node
// CI gate on `npm audit` (B7 Task 20, ruling S15). No dependency.
//   node scripts/audit-gate.mjs                          runs `npm audit --omit=dev --json` and `npm audit --json` itself
//   node scripts/audit-gate.mjs --prod p.json --full f.json [--allow scripts/audit-allow.json]     (used by the tests)
//   node scripts/audit-gate.mjs --check-allowlist        only validates the allowlist file
// FAILS (exit 1) on any high or critical advisory in the production tree (the `--omit=dev` report) that is not in the allowlist, or whose allowlist entry has expired.
// Advisories found only in the full report are development tooling: they are printed as a table and never fail the gate. Moderate and below never fail.
// The allowlist is scripts/audit-allow.json: [{ "advisory": "GHSA-... or the numeric id", "reason": "...", "expires": "YYYY-MM-DD" }]. One entry silences exactly one advisory (every
// package that inherits it) until the end of its expiry day; after that the gate fails again so the decision is re-made. A malformed file is exit 2, never a silent pass.
// Exit codes: 0 pass, 1 findings, 2 the audit or the allowlist could not be read. AUDIT_GATE_TODAY=YYYY-MM-DD overrides the date (tests).
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const today = process.env.AUDIT_GATE_TODAY ?? new Date().toISOString().slice(0, 10)
const BAD = new Set(["high", "critical"])

const fail = (msg, code = 2) => { console.error(`audit-gate: ${msg}`); process.exit(code) }

function loadAllow(file) {
  let list
  try { list = JSON.parse(readFileSync(file, "utf8")) } catch { fail(`cannot read the allowlist ${file}`) }
  if (!Array.isArray(list)) fail("the allowlist must be a JSON array")
  for (const e of list) {
    if (!e || typeof e.advisory !== "string" || !e.advisory || typeof e.reason !== "string" || !e.reason.trim() || typeof e.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires) || Number.isNaN(Date.parse(e.expires))) {
      fail(`bad allowlist entry (needs advisory, reason, expires YYYY-MM-DD): ${JSON.stringify(e)?.slice(0, 120)}`)
    }
  }
  return list
}

function npmAudit(extra) {
  const r = spawnSync("npm", ["audit", ...extra, "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  try { return JSON.parse(r.stdout) } catch { return fail(`npm audit ${extra.join(" ")} gave no JSON (is the registry reachable?)`) }
}
function readJson(file, what) {
  try { return JSON.parse(readFileSync(file, "utf8")) } catch { return fail(`cannot read the ${what} audit report ${file}`) }
}

/** Every high or critical ADVISORY a report contains, with the packages that carry it (directly or by inheritance). */
function advisoriesOf(report) {
  const vulns = report?.vulnerabilities
  if (!vulns || typeof vulns !== "object") fail("the audit report has no `vulnerabilities`")
  const out = new Map() // key -> { id, ghsa, severity, title, owner, packages:Set }
  const ownersOf = (name, seen = new Set()) => {
    if (seen.has(name) || !vulns[name]) return []
    seen.add(name)
    const found = []
    for (const v of vulns[name].via ?? []) {
      if (typeof v === "string") found.push(...ownersOf(v, seen))
      else found.push(v)
    }
    return found
  }
  for (const [name, v] of Object.entries(vulns)) {
    if (!BAD.has(v.severity) && !(v.via ?? []).some((x) => typeof x === "object" && BAD.has(x.severity))) continue
    const advs = ownersOf(name).filter((a) => BAD.has(a.severity))
    if (advs.length === 0) {
      // a high or critical entry with no traceable advisory: never ignore it
      const key = `unknown:${name}`
      if (BAD.has(v.severity)) out.set(key, { id: key, ghsa: "", severity: v.severity, title: "no advisory could be traced", owner: name, packages: new Set([name]) })
      continue
    }
    for (const a of advs) {
      const ghsa = String(a.url ?? "").split("/").pop() ?? ""
      const key = String(a.source ?? ghsa)
      const cur = out.get(key) ?? { id: key, ghsa, severity: a.severity, title: a.title ?? "", owner: a.name, packages: new Set() }
      cur.packages.add(name)
      out.set(key, cur)
    }
  }
  return out
}

const allowFile = opt("--allow") ?? path.join(ROOT, "scripts/audit-allow.json")
/** Every advisory id (numeric source and GHSA) a report mentions at any severity: an allowlist entry for a moderate advisory is not "unused". */
function seenIds(report) {
  const ids = new Set()
  for (const v of Object.values(report?.vulnerabilities ?? {})) for (const x of v.via ?? []) if (typeof x === "object") { ids.add(String(x.source)); ids.add(String(x.url ?? "").split("/").pop()) }
  return ids
}
const allow = loadAllow(allowFile)
if (args.includes("--check-allowlist")) {
  console.log(`audit-gate: allowlist ok (${allow.length} entries)`)
  process.exit(0)
}

const prodReport = opt("--prod") ? readJson(opt("--prod"), "production") : npmAudit(["--omit=dev"])
const fullReport = opt("--full") ? readJson(opt("--full"), "full") : npmAudit([])
const prod = advisoriesOf(prodReport)
const full = advisoriesOf(fullReport)

const entryFor = (a) => allow.find((e) => e.advisory === a.id || (a.ghsa && e.advisory === a.ghsa))
const usedEntries = new Set()
const failures = []
const accepted = []
for (const a of prod.values()) {
  const e = entryFor(a)
  if (e) usedEntries.add(e)
  if (e && e.expires >= today) accepted.push({ a, e })
  else failures.push({ a, why: e ? `allowlist entry expired on ${e.expires}` : "not in the allowlist" })
}

const pkgs = (a) => [...a.packages].sort().join(", ")
console.log(`audit-gate: production tree: ${prod.size} high or critical advisor${prod.size === 1 ? "y" : "ies"}; full tree: ${full.size}; date ${today}`)
if (accepted.length) {
  console.log("\nAccepted in the production tree (scripts/audit-allow.json):")
  for (const { a, e } of accepted) console.log(`  accepted ${a.severity.padEnd(8)} ${(a.ghsa || a.id).padEnd(22)} ${a.owner} via ${pkgs(a)}\n           ${e.reason} (expires ${e.expires})`)
}
// Development-tooling findings: advisories only the full report has, and the packages that carry a production advisory only through dev tooling (for example eslint-config-next or the shadcn CLI).
const devRows = []
for (const a of full.values()) {
  const inProd = prod.get(a.id)
  const carriers = [...a.packages].filter((p) => !inProd || !inProd.packages.has(p)).sort()
  if (carriers.length) devRows.push({ a, carriers })
}
if (devRows.length) {
  console.log("\nDevelopment tooling only (carried by packages that are not in the production tree; informational, does not fail):")
  console.log("  severity  advisory                package            carried by")
  for (const { a, carriers } of devRows) console.log(`  ${a.severity.padEnd(8)}  ${(a.ghsa || a.id).padEnd(22)}  ${String(a.owner).padEnd(17)}  ${carriers.join(", ")}`)
}
const seen = new Set([...seenIds(prodReport), ...seenIds(fullReport)])
for (const e of allow) if (!usedEntries.has(e) && !seen.has(e.advisory)) console.log(`\nunused allowlist entry (matches nothing now; remove it): ${e.advisory}`)
if (failures.length) {
  console.error("\nFAIL: high or critical advisories in the production tree:")
  for (const { a, why } of failures) console.error(`  FAIL ${a.severity.padEnd(8)} ${(a.ghsa || a.id).padEnd(22)} ${a.owner} via ${pkgs(a)}: ${why}\n       ${a.title}`)
  console.error("\nFix the dependency, or add a reasoned, expiring entry to scripts/audit-allow.json (see .claude/docs/deploy/audit-triage.md).")
  process.exit(1)
}
console.log("\naudit-gate: pass")
