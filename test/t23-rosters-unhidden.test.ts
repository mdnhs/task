import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import navigation from "@/public/data/shell/navigation.json"
import roles from "@/public/data/shell/roles.json"
import entitlements from "@/public/data/billing/entitlements.json"
import { filterByEntitlement, toTenantEntitlements, type EntitlementsData } from "@/lib/entitlements"
import { MOCK_DATA_READERS, MOCK_LOADING_FILES, MOCK_MODULES, MOCK_ROUTES, hideMockNav, isMockRoute } from "@/lib/mock-registry"
import { filterNav } from "@/lib/permissions"
import type { Role } from "@/lib/types"
import { getSearchData } from "@/features/search/api"

// B8 Task 23: Location Rosters and My roster are the API's now, so they are no longer mock-only; Staff & Rosters (the FE-only incident and cover model) and the other FE-only modules stay
// hidden behind ENABLE_MOCK_MODULES and untouched (R8-15).
const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", ".local-run", "worktrees"].includes(n)) continue
    const rel = `${dir}/${n}`
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}
const strip = (src: string) => src.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1").replace(/(^|\s)\/\/.*$/gm, "$1")
const roleOf = (id: string) => roles.roles.find((r) => r.id === id) as unknown as Role
const ent = (planId: string) => toTenantEntitlements({ planId, modules: (entitlements.plans as Record<string, string[]>)[planId] }, entitlements as unknown as EntitlementsData)
// The shell layout's own composition (asserted against its source below): role, then plan, then the mock flag.
const shellNav = (role: Role, planId: string) => hideMockNav(filterByEntitlement(filterNav([...navigation.menu, ...navigation.general], role), ent(planId))).map((n) => n.href)

afterEach(() => vi.unstubAllEnvs())

describe("B8 Task 23: Location Rosters without the mock flag", () => {
  test("without ENABLE_MOCK_MODULES the nav shows Location Rosters and My roster for a role with M1A and roster access (a location view for the week), and hides them for a Starter tenant (not in plan) and for a platform user", () => {
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    expect(strip(read("app/(app)/layout.tsx"))).toContain("hideMockNav(filterByEntitlement(filterNav(items, session.role), session.entitlements))")
    for (const r of ["owner", "roster-manager", "location-supervisor", "ops"]) expect(shellNav(roleOf(r), "business"), r).toEqual(expect.arrayContaining(["/rosters", "/rosters/mine"]))
    // Task 23 review I2: the week view needs a location view (the domain's rosterAccess): a staff-home role without a roster level only has its own shifts, so it gets My roster and
    // never a link to a page that would say "Access restricted".
    for (const r of ["employee", "supervisor", "hr", "payroll"]) {
      expect(shellNav(roleOf(r), "business"), r).toContain("/rosters/mine")
      expect(shellNav(roleOf(r), "business"), r).not.toContain("/rosters")
    }
    expect(shellNav(roleOf("owner"), "starter")).not.toEqual(expect.arrayContaining(["/rosters"]))
    expect(shellNav(roleOf("owner"), "starter").filter((h) => h.startsWith("/rosters"))).toEqual([])
    expect(shellNav(roleOf("platform"), "business").filter((h) => h.startsWith("/rosters"))).toEqual([])
    expect(navigation.menu.filter((n) => n.href.startsWith("/rosters")).some((n) => "badge" in n)).toBe(false) // no mock number on the real entries
    vi.stubEnv("ENABLE_MOCK_MODULES", "1")
    expect(shellNav(roleOf("owner"), "business")).toEqual(expect.arrayContaining(["/rosters", "/rosters/mine", "/staff-rosters"]))
  })

  test("with the flag off /rosters renders from the API (no getData reader left under app/(app)/rosters or features/rosters: mock-isolation test)", () => {
    for (const p of ["/rosters", "/rosters/mine", "/rosters/locations", "/rosters/locations/new", "/rosters?week=2026-11-16"]) expect(isMockRoute(p), p).toBe(false)
    expect(MOCK_ROUTES.map((r) => r.prefix)).not.toContain("/rosters")
    expect(MOCK_MODULES).not.toContain("roster")
    const files = [...walk("app/(app)/rosters"), ...walk("features/rosters")].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    const offenders = files.filter((f) => /@\/lib\/data|\bgetData\s*[<(]|\bmockGate\b|\bmockEnabled\b|@\/lib\/mock-registry/.test(strip(read(f))))
    expect(offenders).toEqual([])
    expect(Object.keys(MOCK_DATA_READERS).filter((f) => f.startsWith("features/rosters") || f.startsWith("app/(app)/rosters") || f === "lib/workforce.ts")).toEqual([])
    expect(MOCK_LOADING_FILES.filter((f) => f.startsWith("app/(app)/rosters"))).toEqual([])
    // the loading files draw the roster skeletons at once (no generic fallback any more)
    expect(strip(read("app/(app)/rosters/loading.tsx"))).toMatch(/return <RostersSkeleton \/>/)
    expect(strip(read("app/(app)/rosters/mine/loading.tsx"))).toMatch(/return <MyRosterSkeleton \/>/)
    expect(strip(read("app/(app)/rosters/locations/loading.tsx"))).toMatch(/return <LocationsSkeleton \/>/)
    expect(strip(read("app/(app)/rosters/locations/[id]/loading.tsx"))).toMatch(/return <LocationFormSkeleton \/>/)
  })

  test("staff-rosters, orders-stock, recruitment, files, payroll-issues, manager-attention stay hidden and their pages and data are untouched (git diff on public/data/staff-rosters is empty)", () => {
    const hidden = ["/staff-rosters", "/orders-stock", "/recruitment", "/files", "/payroll-issues", "/manager-attention"]
    expect(MOCK_ROUTES.map((r) => r.prefix).sort()).toEqual([...hidden].sort())
    for (const m of ["attention", "staff", "recruitment", "files", "payroll", "orders"]) expect(MOCK_MODULES).toContain(m)
    vi.stubEnv("ENABLE_MOCK_MODULES", "")
    for (const h of hidden) expect(shellNav(roleOf("owner"), "business"), h).not.toContain(h)
    // the FE-only incident and cover model keeps its own seed (the git diff check of public/data/staff-rosters runs in the task's gates)
    expect(MOCK_DATA_READERS["features/staff-rosters/api.ts"]?.kind).toBe("mock")
    const api = strip(read("features/staff-rosters/api.ts"))
    for (const f of ["staff-rosters/incidents.json", "staff-rosters/roster-gaps.json", "staff-rosters/staff.json"]) expect(api).toContain(f)
  })

  test("Staff & Rosters no longer reads the roster seed: the derived 'From roster' gaps are fed an empty list (R8-15)", async () => {
    expect(strip(read("features/staff-rosters/api.ts"))).not.toMatch(/"rosters\//)
    expect(strip(read("features/staff-rosters/api.ts"))).toContain("gapsFromOpenShifts([], [], [], [], today)")
    const { getDerivedGaps } = await import("@/features/staff-rosters/api")
    expect(await getDerivedGaps({} as never, "Anyone", "2026-10-20")).toEqual([])
  })

  test("Location Rosters no longer links into Staff & Rosters (its gaps are not derived from the roster any more, and the page is hidden without the flag)", () => {
    const files = [...walk("app/(app)/rosters"), ...walk("features/rosters")].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    expect(files.filter((f) => /\/staff-rosters|\bgapsLink\b/.test(strip(read(f))))).toEqual([])
  })

  test("search index no longer lists roster items from the mock index; ⌘K roster hits come from /v1/search if the API indexes them, else none", async () => {
    for (const flag of ["", "1"]) {
      vi.stubEnv("ENABLE_MOCK_MODULES", flag)
      const { items, config } = await getSearchData(roleOf("owner"))
      expect(items.filter((i) => /^\/rosters(\/|\?|$)/.test(i.href)), flag).toEqual([])
      expect(config.actions.filter((a) => /^\/rosters(\/|\?|$)/.test(a.href)), flag).toEqual([])
    }
    // the API indexes no roster entity today, so ⌘K has no roster hits (the search kinds the web knows have no roster kind)
    expect(strip(read("api/src/modules/search/subscribers.ts"))).not.toMatch(/module: "roster"/)
  })

  test("public/data/rosters/*.json is read only by the seed script (reader registry)", () => {
    const dirs = ["app", "lib", "features", "components", "hooks", "scripts", "packages", "e2e", "api/src"]
    const code = dirs.flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes("/node_modules/"))
    const readers = code.filter((f) => /["'`]rosters\/[a-z-]+\.json["'`]/.test(strip(read(f))) || /\brosters\/\$\{/.test(strip(read(f))))
    expect(readers.filter((f) => !f.startsWith("api/src/seed/demo/"))).toEqual([])
  })
})
