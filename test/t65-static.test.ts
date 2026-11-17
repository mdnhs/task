import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// Source-level guards for T6.5 (no DOM in this suite, so these read the files).
const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const exists = (p: string) => existsSync(path.join(root, p))
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", "api", ".git", ".superpowers", "public"].includes(e)) continue
    const rel = `${dir}/${e}`
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".d.ts")) out.push(rel)
  }
  return out
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const files = (dir: string) => walk(dir).filter((f) => !/\.test\.tsx?$/.test(f))

describe("T6.5 the mock stores and cookies of settings, account and audit are gone", () => {
  test("the store files, the branding hook and the mock device cookies no longer exist", () => {
    for (const f of ["features/settings/store.ts", "features/account/store.ts", "features/audit/store.ts", "hooks/use-branding.ts"]) expect(exists(f), f).toBe(false)
    expect(strip(read("lib/device-session.ts"))).not.toMatch(/od-devreg|od-devpol|od-mfareq|getDeviceRegister|deviceCookieNames/)
  })
  test("nothing in settings, account, audit, search or the pages imports a store, a mock register or the support-access store", () => {
    const offenders: string[] = []
    for (const f of [...files("features/settings"), ...files("features/account"), ...files("features/audit"), ...files("features/search"), ...files("app/(app)/settings"), ...files("app/(app)/account"), ...files("app/(app)/audit-log")]) {
      const src = strip(read(f))
      const mockPanel = /components\/(template|notifications)-panel\.tsx$/.test(f) // MOCK until T6.7 / B9: a local store, gated by mockEnabled()
      if (/from ["'](\.\.\/)+store["']|from ["']\.\/store["']|useTenantLogo|use-branding|use-support-access|support-data|getDeviceRegister|saveDevices\b|saveDevicePolicies|saveMfaPolicy|actions\/security/.test(src) || (!mockPanel && /createStore/.test(src))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
  test("the session no longer merges a branding cookie", () => {
    expect(strip(read("lib/session.ts"))).not.toMatch(/withBranding|od-brand-/)
    expect(strip(read("app/actions/session.ts"))).not.toMatch(/saveBranding|od-brand-/)
  })
})

describe("T6.5 pages: every one that reads the API checks the second factor first; no loading file reads the network", () => {
  test("settings, account, audit-log and support-access call requireMfaOk()", () => {
    for (const f of ["app/(app)/settings/[tab]/page.tsx", "app/(app)/account/[tab]/page.tsx", "app/(app)/audit-log/page.tsx", "app/(app)/settings/support-access/page.tsx"]) expect(strip(read(f)), f).toMatch(/requireMfaOk\(\)/)
  })
  test("support-access has a page and a loading file, and the notification link /settings/support-access resolves to it", () => {
    expect(exists("app/(app)/settings/support-access/page.tsx")).toBe(true)
    expect(exists("app/(app)/settings/support-access/loading.tsx")).toBe(true)
    // the dynamic [tab] route must not swallow it: the static segment wins in Next, and "support-access" is not a settings tab
    expect(read("features/settings/types.ts")).not.toMatch(/id: "support-access"/)
    expect(read("lib/notifications.ts")).toMatch(/\/settings\/support-access|settings\/privacy/)
  })
  test("settings, account, audit and search loading files import no data layer", () => {
    for (const f of ["app/(app)/settings/[tab]/loading.tsx", "app/(app)/account/[tab]/loading.tsx", "app/(app)/audit-log/loading.tsx", "app/(app)/settings/support-access/loading.tsx"]) {
      const src = strip(read(f))
      expect(src, f).not.toMatch(/getData|lib\/data|lib\/api|apiServer|getSession|peekSession|getUser|getOrg\b|getPeople|getAuditEvents|getUsersAndInvites|getOrganisation|getDepartments|getRoles|loadSettings|getSupportGrants/)
    }
  })
})

describe("T6.5 secrets and the enrolment code", () => {
  test("the device panel and the account 'This device' row never store a code or put it in a URL or storage", () => {
    for (const f of ["features/settings/components/devices-panel.tsx", "features/account/components/security-panel.tsx", "features/account/components/this-device.tsx"]) {
      if (!exists(f)) continue
      const src = strip(read(f))
      expect(src, f).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|history\.(push|replace)State|router\.(push|replace)\(.*code/)
    }
  })
  test("the privacy and device code paths do not log", () => {
    for (const f of [...files("features/settings"), ...files("features/account")]) expect(strip(read(f)), f).not.toMatch(/console\.(log|info|debug|warn|error)/)
  })
  test("the invite panel never reads a token or builds an invite link", () => {
    expect(strip(read("features/settings/components/users-panel.tsx"))).not.toMatch(/\btoken\b|invite\?token|\/invite\?/)
  })
})

describe("T6.5 branding: colour only unless the plan has the files module", () => {
  test("the panel shows one hint line and no upload when the plan has no files module", () => {
    const src = strip(read("features/settings/components/branding-panel.tsx"))
    expect(src).toMatch(/canUpload/)
    expect(src).toMatch(/Logo upload isn&apos;t in your plan|Logo upload is not in your plan/)
  })
})
