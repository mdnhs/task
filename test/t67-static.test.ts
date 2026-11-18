import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// Source-level guards for T6.7 (no DOM here, so these read the files): the deleted mock modules stay deleted, the real-data path takes no clock or zone from the browser, no loading file
// reaches the API, every page that calls the API checks the second factor, and the export URL is never kept.
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

describe("T6.7 deleted mock modules (ruling I17)", () => {
  test("the mock shift, report, Today and inbox modules and the roster overlay are gone", () => {
    for (const f of ["features/reports/store.ts", "hooks/use-shifts.ts", "lib/shifts-data.ts", "lib/shift-reports-data.ts", "lib/today-data.ts", "lib/task-inbox.ts", "lib/roster-overlay.ts"]) expect(existsSync(path.join(root, f)), f).toBe(false)
  })
  test("nothing imports them", () => {
    const offenders: string[] = []
    for (const f of code) {
      const src = strip(read(f))
      if (/(today-data|shift-reports-data|shifts-data|use-shifts|task-inbox|roster-overlay|reports\/store|["']\.\.?\/store["'])/.test(src) && !/features\/(rosters|tasks|files|orders|payroll|recruitment|staff-rosters|assistant|attention|search|billing|audit|account|settings|platform)\//.test(f)) offenders.push(f)
      if (/@\/lib\/(today-data|shift-reports-data|shifts-data|task-inbox|roster-overlay)|@\/hooks\/use-shifts/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe("T6.7 real-data path: no browser clock or zone", () => {
  const real = code.filter((f) => /^features\/(reports|shifts|dashboard)\//.test(f) && !f.endsWith("skeletons.tsx"))
  test("no new Date(), Date.now(), Intl zone lookup or toLocale* in the shifts, reports and dashboard features (times come from the stored instants and the tenant zone)", () => {
    const offenders: string[] = []
    for (const f of real) {
      const src = strip(read(f))
      if (/new Date\(|Date\.now\(|resolvedOptions\(\)|toLocale(Date|Time)?String|getTimezoneOffset/.test(src)) offenders.push(f)
    }
    // the two named exceptions: a nonce for a download path (a unique string, never a time) and the row-id suffix
    expect(offenders.filter((f) => !/export-menu\.tsx|attachment-open\.tsx/.test(f))).toEqual([])
  })
})

describe("T6.7 loading files and pages", () => {
  const loadings = ["app/(app)/(home)/loading.tsx", "app/(app)/shifts/loading.tsx", "app/(app)/daily-reports/loading.tsx", "app/(app)/daily-reports/[id]/loading.tsx"]
  test("the four loading files exist and import no data layer", () => {
    for (const f of loadings) {
      expect(existsSync(path.join(root, f)), f).toBe(true)
      const src = strip(read(f))
      expect(src, f).not.toMatch(/@\/lib\/session["']|@\/lib\/api\/|apiServer|apiBrowser|lib\/data["']|\/api["']|load[A-Z]\w*\(|requireMfaOk|getOrg|getSession|lastSegment/)
    }
  })
  test("every page that calls the API calls requireMfaOk() first", () => {
    for (const f of ["app/(app)/(home)/page.tsx", "app/(app)/shifts/page.tsx", "app/(app)/daily-reports/page.tsx", "app/(app)/daily-reports/[id]/page.tsx"]) {
      const src = read(f)
      expect(src, f).toContain("requireMfaOk()")
      expect(src.indexOf("requireMfaOk()"), f).toBeLessThan(src.search(/[sS]creenData\(|loadReport\(|loadShifts\(|loadManagerHome\(|loadStaffHome\(/))
    }
  })
  test("the home, shifts and report pages give an API refusal a full-page state instead of a crash", () => {
    for (const f of ["app/(app)/(home)/page.tsx", "app/(app)/shifts/page.tsx", "app/(app)/daily-reports/page.tsx", "app/(app)/daily-reports/[id]/page.tsx"]) expect(read(f), f).toContain("apiFailureView(")
  })
})

describe("T6.7 exports and report files: no URL is ever kept", () => {
  test("the export, attachment and report code never writes a download URL to storage or state", () => {
    for (const f of code.filter((x) => /^features\/reports\//.test(x))) {
      const src = strip(read(f))
      expect(src, f).not.toMatch(/(localStorage|sessionStorage|indexedDB|document\.cookie)/)
    }
    const exp = strip(read("features/reports/export.ts"))
    expect(exp).toContain("exportPath")
    expect(exp).not.toMatch(/useState|createStore|\.set\(/)
  })
  test("the export menu opens the file only through openExport (a probe then a SECOND fresh path) and stops polling when the page is left", () => {
    const src = read("features/reports/components/export-menu.tsx")
    expect(src).toContain("openExport(")
    expect(src).toContain("abort.current?.abort()")
    expect(src).toContain("visibilitychange")
    expect(src).toContain("EXPORT_COPY.pdfNote") // the Latin-1 note where PDF is offered
  })
})

describe("T6.7 attention (I18)", () => {
  test("the /manager-attention page is the mock queue: unavailable unless ENABLE_MOCK_MODULES is set; the dashboard card reads GET /v1/attention", () => {
    const page = read("app/(app)/manager-attention/page.tsx")
    expect(page).toContain("mockEnabled()")
    expect(page).toContain("NotAvailableYet")
    expect(page.indexOf("mockEnabled()")).toBeLessThan(page.indexOf("getAttention()"))
    expect(read("features/dashboard/api.ts")).toContain('"/v1/attention"')
  })
})

describe("T6.7 report scope and writes", () => {
  test("the report screens do not re-scope: no teamOf, scopeReports or reportScope on API data", () => {
    for (const f of code.filter((x) => /^features\/(reports|shifts|dashboard)\//.test(x) || /^app\/\(app\)\/(daily-reports|shifts|\(home\))\//.test(x))) {
      expect(strip(read(f)), f).not.toMatch(/\bteamOf\(|\bscopeReports\(|\binScope\(|\breportScope\(/)
    }
  })
  test("a draft save and a submit always send the version; the submit body is exactly { version, requestId }", () => {
    const c = strip(read("features/reports/client.ts"))
    expect(c).toMatch(/body: \{ version: r\.version, requestId \}/)
    expect(c).toContain("toReportBody(r)")
  })
  test("the editor reaches the API through the autosave hook and the idempotent submitter only", () => {
    const e = strip(read("features/reports/components/report-editor.tsx"))
    expect(e).toContain("makeDraftSession(")
    expect(read("features/reports/session.ts")).toContain("makeSubmitter(")
    expect(e).not.toMatch(/crypto\.randomUUID\(\)(?!\.slice)/) // the request id is made inside the submitter, once per attempt
    expect(e).not.toMatch(/saveDraft\(/) // saves go through the debounced saver
  })
  test("the owner is never offered Accept or Return", () => {
    const r = strip(read("features/reports/components/report-review.tsx"))
    expect(r).toMatch(/r\.personId !== meId/)
  })
})
