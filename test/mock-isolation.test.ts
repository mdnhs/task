import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import navigation from "@/public/data/shell/navigation.json"
import { MOCK_DATA_READERS, MOCK_LOADING_FILES, MOCK_ROUTES, MOCK_SETTINGS_FILES, STATIC_LOADING_READERS, STATIC_SETTINGS_FILES, hideMockNav, isMockRoute, mockEnabled } from "@/lib/mock-registry"
import { mockGate } from "@/features/shell/components/not-available"

// B6 T6.9 mock isolation (Review Focus 5): a switched feature never depends on mock-only behaviour, and the mock-only features exist only behind ENABLE_MOCK_MODULES=1.
const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", "test"].includes(n)) continue
    const rel = `${dir}/${n}`
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}
// Comments start at a line start or after whitespace, so "/v1/*" or "https://" inside a string is left alone.
const strip = (src: string) => src.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1").replace(/(^|\s)\/\/.*$/gm, "$1")
const SRC_DIRS = ["app", "lib", "features", "components", "hooks"]
const code = SRC_DIRS.flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
const isComponent = (f: string) => /^(components|hooks)\//.test(f) || /^features\/[^/]+\/components\//.test(f)
const isRoute = (f: string) => f.startsWith("app/")

afterEach(() => vi.unstubAllEnvs())

describe("1. the JSON reader is used only by the files the registry lists", () => {
  const readers = code.filter((f) => f !== "lib/data.ts" && /from "(@\/lib\/data|\.\/data)"/.test(strip(read(f))))
  test("every importer of lib/data is in MOCK_DATA_READERS", () => {
    expect(readers.filter((f) => !(f in MOCK_DATA_READERS))).toEqual([])
  })
  test("a getData( call (not dataTransfer.getData) exists only in those files", () => {
    const callers = code.filter((f) => f !== "lib/data.ts" && /(^|[^.\w])getData\s*[<(]/.test(strip(read(f))))
    expect(callers.filter((f) => !(f in MOCK_DATA_READERS))).toEqual([])
  })
  test("the registry has no stale entry (every listed file exists and still reads the JSON)", () => {
    expect(Object.keys(MOCK_DATA_READERS).filter((f) => !readers.includes(f))).toEqual([])
  })
  test("the static settings seeds are the files the registry names (T6.5 carry-in)", () => {
    const refs = [...strip(read("features/settings/api.ts")).matchAll(/getData\b[\s\S]*?\("(settings\/[^"]+)"\)/g)].map((m) => m[1]).sort()
    expect(refs).toEqual([...STATIC_SETTINGS_FILES, ...MOCK_SETTINGS_FILES].sort())
    for (const f of [...STATIC_SETTINGS_FILES, ...MOCK_SETTINGS_FILES]) expect(existsSync(path.join(root, "public/data", f)), f).toBe(true)
  })
})

describe("2. switched features do not use the mock behaviours", () => {
  test("no route, component or hook names ME_ID, materialiseRecurring, mergeIncoming, scopeReports or the seed isAssigned filter", () => {
    const offenders = code.filter((f) => isRoute(f) || isComponent(f)).filter((f) => /\b(ME_ID|materialiseRecurring|mergeIncoming|scopeReports|isAssigned)\b/.test(strip(read(f))))
    expect(offenders).toEqual([])
  })
  test("the only importer of ME_ID is the mock search index (and lib/people itself)", () => {
    expect(code.filter((f) => /\bME_ID\b/.test(strip(read(f)))).sort()).toEqual(["features/search/api.ts", "lib/people.ts"])
  })
})

describe("3. loading.tsx never reads a data layer", () => {
  const loadings = code.filter((f) => f.endsWith("/loading.tsx") || f === "app/loading.tsx")
  const others = loadings.filter((f) => !MOCK_LOADING_FILES.includes(f))
  test("outside the mock pages: no features/*/api, lib/api, lib/data, lib/session, getOrg, getMock* or getData", () => {
    const bad = others.filter((f) => /@\/features\/[a-z-]+\/api"|@\/lib\/api|@\/lib\/data|@\/lib\/session"|\bgetOrg\b|\bgetMock\w+\b|\bgetData\b|\bapiServer\b/.test(strip(read(f))))
    expect(bad).toEqual([])
  })
  test("outside the mock pages: the only readers called are the static catalogue ones", () => {
    const bad = others.flatMap((f) => [...strip(read(f)).matchAll(/\bawait\s+(get[A-Z]\w*)\(/g)].map((m) => ({ f, name: m[1] }))).filter((x) => !STATIC_LOADING_READERS.includes(x.name))
    expect(bad).toEqual([])
  })
  test("a loading file that reads the seed belongs to a mock page, and falls back to the generic skeleton with the flag off", () => {
    for (const f of MOCK_LOADING_FILES) {
      expect(existsSync(path.join(root, f)), f).toBe(true)
      expect(strip(read(f)), f).toMatch(/if \(!mockEnabled\(\)\) return <PageSkeleton/)
    }
    const seedReaders = loadings.filter((f) => /@\/lib\/data|@\/features\/[a-z-]+\/api"|\bget(Mock|Candidates|Payroll|Orders|Files|Attention|Rosters|Roster\w*|DerivedGaps)\w*\(/.test(strip(read(f))))
    expect(seedReaders.filter((f) => !MOCK_LOADING_FILES.includes(f))).toEqual([])
  })
})

describe("4. mock routes exist only behind ENABLE_MOCK_MODULES=1", () => {
  const mockPages = code.filter((f) => /^app\/\(app\)\/.+\/page\.tsx$/.test(f)).filter((f) => isMockRoute(`/${f.replace(/^app\/\(app\)\//, "").replace(/\/page\.tsx$/, "")}`))
  test("the flag is read in exactly one place", () => {
    const readers = code.filter((f) => /process\.env\.ENABLE_MOCK_MODULES|env\.ENABLE_MOCK_MODULES/.test(strip(read(f))))
    expect(readers).toEqual(["lib/mock-registry.ts"])
  })
  test("every page under a mock route starts with the gate, before any data call", () => {
    expect(mockPages.length).toBeGreaterThanOrEqual(11)
    for (const f of mockPages) {
      const src = strip(read(f))
      const body = src.slice(src.indexOf("export default"))
      expect(body, f).toMatch(/const off = mockGate\("[^"]+"\)\s*\n\s*if \(off\) return off/)
      expect(body.indexOf("mockGate("), f).toBeLessThan(body.search(/\bawait\b/))
    }
  })
  test("the unavailable state with the flag unset, '0' or 'true'; the page with '1'", () => {
    for (const v of [undefined, "", "0", "true", "yes"]) {
      vi.stubEnv("ENABLE_MOCK_MODULES", v as string)
      expect(mockEnabled(), String(v)).toBe(false)
      const el = mockGate("Orders & Stock") as { props: { moduleLabel: string } } | null
      expect(el?.props.moduleLabel).toBe("Orders & Stock")
    }
    vi.stubEnv("ENABLE_MOCK_MODULES", "1")
    expect(mockEnabled()).toBe(true)
    expect(mockGate("Orders & Stock")).toBeNull()
  })
  test("the nav drops every mock entry with the flag unset and keeps them all with it set; real entries stay", () => {
    const all = [...navigation.menu, ...navigation.general]
    const mockHrefs = all.filter((n) => isMockRoute(n.href)).map((n) => n.href)
    expect(mockHrefs.length).toBeGreaterThanOrEqual(MOCK_ROUTES.length) // every mock route has a nav entry
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    expect(hideMockNav(all).map((n) => n.href)).toEqual(["/", "/tasks", "/daily-reports", "/shifts", "/settings", "/audit-log"])
    expect(hideMockNav(all).some((n) => "badge" in n)).toBe(false) // the seed's badge counts are mock numbers
    vi.stubEnv("ENABLE_MOCK_MODULES", "1")
    expect(hideMockNav(all).map((n) => n.href)).toEqual(all.map((n) => n.href))
    expect(hideMockNav(all).some((n) => "badge" in n)).toBe(true)
  })
  test("the shell layout filters the nav and the assistant through the registry", () => {
    const layout = strip(read("app/(app)/layout.tsx"))
    expect(layout).toContain("hideMockNav(")
    expect(layout).toMatch(/!mockEnabled\(\) \|\| !hasProductModule/)
  })
  test("the roster rule-check server actions refuse without the flag", () => {
    const a = strip(read("app/(app)/rosters/actions.ts"))
    expect(a.match(/!mockEnabled\(\)/g)?.length).toBe(2)
  })
})

describe("5. the files I15 named are gone and nothing imports them", () => {
  const gone = [
    "lib/task-inbox.ts", "lib/task-notices.ts", "lib/audit-outbox.ts", "hooks/use-notify-feed.ts", "lib/notify-data.ts",
    "features/tasks/store.ts", "features/reports/store.ts", "features/audit/store.ts", "features/settings/store.ts", "features/account/store.ts",
    "hooks/use-shifts.ts", "hooks/use-support-access.ts", "hooks/use-branding.ts", "lib/shifts-data.ts", "lib/shift-reports-data.ts", "lib/today-data.ts",
  ]
  test("deleted", () => {
    for (const f of gone) expect(existsSync(path.join(root, f)), f).toBe(false)
  })
  test("no import mentions them, and the device cookies of the mock are gone", () => {
    const names = gone.map((f) => f.replace(/\.ts$/, "").replace(/^(lib|hooks)\//, "").replace(/^features\/([^/]+)\/store$/, "$1/store"))
    const offenders = code.filter((f) => names.some((n) => new RegExp(`from "[^"]*/${n.replace("/", "\\/")}"`).test(strip(read(f)))))
    expect(offenders).toEqual([])
    expect(strip(read("lib/device-session.ts"))).not.toMatch(/od-device|od-role|od-auth|document\.cookie/)
    expect(code.filter((f) => /["'`]od-(role|auth|staff-role|device)["'`]/.test(strip(read(f))))).toEqual([])
  })
  test("lib/store.ts (createStore) stays: the mock features use it", () => {
    expect(existsSync(path.join(root, "lib/store.ts"))).toBe(true)
  })
})
