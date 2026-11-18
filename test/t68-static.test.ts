import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// Source-level guards for T6.8 (the platform console on the API).
const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next"].includes(n)) continue
    const rel = `${dir}/${n}`
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const code = ["app", "features", "lib", "components", "hooks"].flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
const pages = walk("app/(platform)").filter((f) => /\/page\.tsx$/.test(f))
const loadings = walk("app/(platform)").filter((f) => /\/loading\.tsx$/.test(f))

describe("T6.8 carry-ins", () => {
  test("the support mock readers are gone and nothing imports them", () => {
    for (const f of ["hooks/use-support-access.ts", "lib/support-data.ts", "features/platform/components/support-view.tsx", "features/platform/support.ts"]) expect(existsSync(path.join(root, f)), f).toBe(false)
    const offenders = code.filter((f) => /use-support-access|support-data|from "\.\.?\/support"/.test(strip(read(f))))
    expect(offenders).toEqual([])
  })
  test("the mock task seed files are deleted and nothing reads them", () => {
    for (const f of ["public/data/tasks/tasks.json", "public/data/tasks/projects.json", "public/data/tasks/templates.json"]) expect(existsSync(path.join(root, f)), f).toBe(false)
    expect(code.filter((f) => /tasks\/(tasks|projects|templates)\.json/.test(strip(read(f))))).toEqual([])
  })
  test("the operator is the signed-in user: no od-staff-role override, no staff.json operator", () => {
    expect(code.filter((f) => /od-staff-role|operatorId/.test(strip(read(f))))).toEqual([])
    expect(existsSync(path.join(root, "public/data/platform/staff.json"))).toBe(false)
  })
})

describe("T6.8 the console MFA gate", () => {
  test("the console session computes the second factor from the API, not a hard-coded ok", () => {
    const s = strip(read("lib/session.ts"))
    expect(s).toContain("resolvePlatformMfa")
    expect(s).not.toMatch(/drive: false, mfa: "ok", twoFactorEnabled: r\.me/)
  })
  test("the gate and the layout render the gate components instead of data when the factor is outstanding", () => {
    const g = read("app/(platform)/gate.tsx")
    expect(g).toContain('mfa !== "ok"')
    expect(g).toMatch(/MfaGate/)
    expect(g).toMatch(/MfaStepUp/)
    const l = read("app/(platform)/layout.tsx")
    expect(l).toMatch(/mfa === "enrol" \? <MfaGate/)
    expect(l).toMatch(/mfa === "challenge" \? <MfaStepUp/)
  })
  test("every console page calls gate() first, and the search action checks the factor", () => {
    for (const f of pages) {
      const src = read(f)
      if (/\bNotAvailableYet|unavailablePlatformPage\b/.test(src) && !/gate\(/.test(src)) continue
      expect(src, f).toMatch(/\bgate\(/)
    }
    expect(read("app/actions/platform-search.ts")).toMatch(/mfa/)
  })
})

describe("T6.8 loading files", () => {
  test("every platform loading.tsx is static: no data layer, no session, no API", () => {
    expect(loadings.length).toBeGreaterThan(8)
    for (const f of loadings) {
      const src = strip(read(f))
      expect(src, f).not.toMatch(/@\/lib\/session["']|@\/lib\/api\/|apiServer|getPlatform\w*\(|getOperator|getMockOrg|skeletonGate|lib\/data["']|gate\(/)
    }
  })
  test("the root loading.tsx does not read the console seed either", () => {
    expect(strip(read("app/loading.tsx"))).not.toMatch(/getOperator|getPlatformEnv|loadEnv|apiServer/)
  })
})

describe("T6.8 unbacked pages (I16)", () => {
  test("plans, billing, change-plan and schedule-deletion show the unavailable state unless ENABLE_MOCK_MODULES is set", () => {
    for (const f of walk("app/(platform)").filter((x) => /(plans|billing|change-plan|schedule-deletion)\/(?:.*\/)?page\.tsx$/.test(x))) expect(read(f), f).toMatch(/unavailablePlatformPage|mockEnabled/)
  })
  test("the nav hides unbacked entries when the flag is off", () => {
    expect(read("features/platform/mock.ts")).toMatch(/mockEnabled|ENABLE_MOCK_MODULES/)
  })
})

describe("T6.8 pages read through apiServer, not the seed", () => {
  test("the live pages import no seed reader", () => {
    for (const f of ["app/(platform)/platform/page.tsx", "app/(platform)/platform/tenants/page.tsx", "app/(platform)/platform/team/page.tsx", "app/(platform)/platform/settings/page.tsx", "app/(platform)/platform/audit/page.tsx", "app/(platform)/platform/data-requests/page.tsx", "app/(platform)/platform/support/page.tsx"])
      expect(strip(read(f)), f).not.toMatch(/getPlatformSeed|getStaff\b|getPlatformSettings/)
  })
  test("the audit export is a same-origin BFF link", () => {
    expect(read("features/platform/components/live-audit.tsx")).toContain("/v1/platform/audit/export")
  })
})
