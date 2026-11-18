import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = path.resolve(__dirname, "..")
type Advisory = { source: number; name: string; severity: "moderate" | "high" | "critical"; title: string; url: string; range: string }
const adv = (source: number, name: string, severity: Advisory["severity"], ghsa = `GHSA-aaaa-bbbb-${source}`): Advisory => ({ source, name, severity, title: `${name} advisory ${source}`, url: `https://github.com/advisories/${ghsa}`, range: "<1.0.0" })
/** A minimal `npm audit --json` document: each entry is { package, advisories it owns, packages it only inherits from }. */
function audit(entries: Array<{ pkg: string; own?: Advisory[]; via?: string[]; severity?: string }>) {
  const vulnerabilities: Record<string, unknown> = {}
  for (const e of entries) {
    const via = [...(e.own ?? []), ...(e.via ?? [])]
    const sev = e.severity ?? ((e.own ?? []).some((a) => a.severity === "critical") ? "critical" : (e.own ?? []).some((a) => a.severity === "high") ? "high" : "moderate")
    vulnerabilities[e.pkg] = { name: e.pkg, severity: sev, isDirect: false, via, effects: [], range: "*", nodes: [`node_modules/${e.pkg}`], fixAvailable: false }
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } }
}
function run(prod: unknown, full: unknown, allow: unknown = [], env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "audit-gate-"))
  const p = (n: string, v: unknown) => { const f = path.join(dir, n); writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v)); return f }
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/audit-gate.mjs"), "--prod", p("prod.json", prod), "--full", p("full.json", full), "--allow", p("allow.json", allow)], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", AUDIT_GATE_TODAY: "2026-11-18", ...env } as unknown as NodeJS.ProcessEnv })
  return { status: r.status, out: r.stdout + r.stderr }
}

const clean = audit([])
const highProd = audit([{ pkg: "bad-lib", own: [adv(1001, "bad-lib", "high", "GHSA-1111-2222-3333")] }])
const devOnly = audit([{ pkg: "dev-tool", own: [adv(2002, "dev-tool", "high", "GHSA-4444-5555-6666")] }, { pkg: "dev-wrapper", via: ["dev-tool"], severity: "high" }])

describe("npm audit gate (B7 Task 20)", () => {
  test("gate fails on a high advisory in the production tree", () => {
    const r = run(highProd, highProd)
    expect(r.status).toBe(1)
    expect(r.out).toContain("bad-lib")
    expect(r.out).toContain("GHSA-1111-2222-3333")
  })

  test("gate fails on a critical advisory, and on a high one that reaches production only through another package", () => {
    expect(run(audit([{ pkg: "boom", own: [adv(1, "boom", "critical")] }]), clean).status).toBe(1)
    const viaOnly = audit([{ pkg: "inner", own: [adv(7, "inner", "high")] }, { pkg: "outer", via: ["inner"], severity: "high" }])
    const r = run(viaOnly, viaOnly)
    expect(r.status).toBe(1)
    expect(r.out).toContain("outer")
  })

  test("gate passes with high advisories only in dev dependencies and lists them", () => {
    const r = run(clean, devOnly)
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/dev-tool/)
    expect(r.out).toMatch(/GHSA-4444-5555-6666/)
    expect(r.out).toMatch(/dev|not in the production tree/i)
  })

  test("moderate advisories never fail the gate", () => {
    expect(run(audit([{ pkg: "meh", own: [adv(3, "meh", "moderate")] }]), clean).status).toBe(0)
  })

  test("an allowlist entry silences exactly one advisory until its expiry", () => {
    const two = audit([{ pkg: "bad-lib", own: [adv(1001, "bad-lib", "high", "GHSA-1111-2222-3333")] }, { pkg: "other-lib", own: [adv(1002, "other-lib", "high", "GHSA-7777-8888-9999")] }])
    const allow = [{ advisory: "GHSA-1111-2222-3333", reason: "not reached", expires: "2027-02-01" }]
    const r = run(two, two, allow)
    expect(r.status).toBe(1) // the second advisory is not silenced
    expect(r.out).toContain("other-lib")
    expect(r.out).not.toMatch(/FAIL[^\n]*bad-lib/)
    const only = run(highProd, highProd, allow)
    expect(only.status).toBe(0)
    expect(only.out).toMatch(/accepted/i)
    expect(only.out).toContain("not reached")
    // the numeric advisory id works too, the entry expiring today is still valid
    expect(run(highProd, highProd, [{ advisory: "1001", reason: "r", expires: "2026-11-18" }]).status).toBe(0)
  })

  test("an expired allowlist entry fails the gate", () => {
    const r = run(highProd, highProd, [{ advisory: "GHSA-1111-2222-3333", reason: "not reached", expires: "2026-11-17" }])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/expired/i)
  })

  test("a malformed allowlist (missing reason or expiry, bad date) is exit 2, never a silent pass", () => {
    for (const bad of [[{ advisory: "x", expires: "2027-01-01" }], [{ advisory: "x", reason: "r" }], [{ advisory: "x", reason: "r", expires: "soon" }], { not: "an array" }]) {
      expect(run(clean, clean, bad).status, JSON.stringify(bad)).toBe(2)
    }
    expect(run("not json", clean).status).toBe(2)
  })

  test("an allowlist entry that matches nothing is reported but does not fail", () => {
    const r = run(clean, clean, [{ advisory: "GHSA-0000-0000-0000", reason: "old", expires: "2027-01-01" }])
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/unused/i)
  })

  test("the repo's own allowlist file is well formed (its expiry dates are enforced by the gate run in CI, not by this test)", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/audit-gate.mjs"), "--check-allowlist"], { cwd: ROOT, encoding: "utf8" })
    expect(r.status).toBe(0)
  })
})
