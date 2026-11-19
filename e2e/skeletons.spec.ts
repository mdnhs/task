import { appendFileSync } from "node:fs"
import { apiAs, expect, test } from "./fixtures"
import { PROXY_ORIGIN, type Persona } from "./stack-env"

// Skeleton parity (architecture.md -> Skeletons, B6 T6.9): for each page the route's loading.tsx is held on screen (the API answers are delayed by e2e/slow-api.mjs, only the paths the
// page itself reads), measured, then the real page arrives and is measured again. The blocks of the page (children of <main>, one level down) must agree within TOL px at 1568, 768
// and 390 wide, and so must the total height. Results are appended to test-results/skeleton-measurements.jsonl (recorded in .claude/docs/architecture.md).
const SLOW = PROXY_ORIGIN
const TOL = 3
// EXACT: the page and its skeleton agree within TOL px in total and in EVERY block (head, filters, cards, table, pager), at the widths listed. This is the project rule (exact skeletons);
// a regression here fails. The constant, non-data-dependent differences found in T6.9 (the seats field, the invoice empty state, stat note line, team row lines, the shifts week
// footnote wrapper and typical rows, the evidence-tag rows and the Load more button of the lists) were fixed in the skeletons.
const EXACT: Record<string, number[]> = {
  "dashboard manager": [1568],
  "shifts week": [1568, 768],
  "tasks list": [1568],
  "billing": [1568, 768, 390],
  // The audit log skeleton draws the typical mature log (more than the API's first page of 100: the "Showing the latest" sentence and Load older), as the e2e world's is (B8 Task 25 took it past 100).
  "audit": [1568],
  "reports inbox": [1568],
  "console overview": [1568, 768, 390],
  // Location Rosters (B8 Task 25): the office's My roster and a location with the typical two shift types.
  "my roster office": [1568, 768, 390],
  "location form liffey": [1568]
}
// CEILING: what is left cannot be exact because the real page depends on data (a task row with an evidence tag, a wrapped id, the number of sessions or people, a report's rows),
// on the role (K4: loading.tsx is static and draws the typical OWNER view, so staff pages are shorter) or on tables turning into stacked cards below 768px. The number is the
// measured |total difference| x 1.25 + 40 (the data moves a little between runs); a page that drifts further fails. Listed under "Remaining work" in architecture.md.
const CEILING: Record<string, number> = {
  "dashboard staff@1568": 1082,
  "reports member@1568": 516,
  "report review@1568": 240,
  "shifts member@1568": 885,
  "task detail@1568": 303,
  "console tenants@1568": 452,
  "console audit@1568": 16300,
  "account security@1568": 240,
  "dashboard manager@768": 501,
  "dashboard staff@768": 1958,
  "reports inbox@768": 760,
  "reports member@768": 589,
  "report review@768": 310,
  "shifts member@768": 885,
  "tasks list@768": 255,
  "task detail@768": 238,
  "audit@768": 339,
  "console tenants@768": 452,
  "console audit@768": 16300,
  "account security@768": 240,
  "dashboard manager@390": 586,
  "dashboard staff@390": 1977,
  "reports inbox@390": 82,
  "reports member@390": 3445,
  "report review@390": 864,
  "shifts week@390": 505, // the filter bar is exact (2 rows on a phone since the skeleton nav is 244 px); the stacked cards differ by the week's shift names and chips per day (data): 369 px over 10 rows
  "shifts member@390": 5292,
  "tasks list@390": 60,
  "task detail@390": 151,
  "audit@390": 330,
  // Console tenants: the skeleton is the real view with 8 typical rows, the e2e stack has 3 tenants: the difference is the 5 missing rows (66 px a row at 1568/768, 435 px a stacked card at 390 since
  // Task 24 added health, usage and MRR to each card), so |diff| x 1.25 + 40 holds per row count. Row structure is exact (the skeleton renders the real component).
  "console tenants@390": 2760,
  // Console audit: the log is the newest 200 platform entries and the e2e stack's has one more row per run (the seed's owner_bootstrapped, never reset), so its height is the row count x a row
  // (90 px at 1568/768, 140 at 390; the skeleton draws 20 rows of the same structure, uuid ids and a before/after line). The ceiling is the 200-row cap, the head is held exact (LEAD).
  "console audit@390": 25300,
  "account security@390": 500,
  // Location Rosters (B8 Task 25, measured on the e2e world: |diff| x 1.25 + 40). The owner's week: the head and the week board are exact (LEAD below); the panels under it are the
  // data of the week on screen (a change request and an open shift add two panels, a short history is shorter than the skeleton's typical page of 20). The supervisor (Ismail, one site,
  // no templates panel on a published week) and the staff "Access restricted" page differ by the role (K4: loading.tsx draws the typical office view). The locations list has the
  // world's two extra sites (the skeleton draws the seed's three: +68 px a row), the Coppers form has more shift types than the typical two, a staff My roster has fewer sections.
  "rosters week@1568": 561,
  "rosters week@768": 526,
  "rosters week@390": 419,
  "rosters supervisor@1568": 832,
  "rosters supervisor@768": 838,
  "rosters supervisor@390": 633,
  "rosters staff@1568": 2182,
  "rosters staff@768": 2495,
  "rosters staff@390": 4405,
  "roster locations@1568": 210,
  "roster locations@768": 210,
  "roster locations@390": 385,
  "location form coppers@1568": 598,
  "location form coppers@768": 598,
  "location form coppers@390": 991,
  "location form liffey@768": 83,
  "location form liffey@390": 223,
  "my roster staff@1568": 85,
  "my roster staff@768": 85,
  "my roster staff@390": 151
}
// LEAD: for a CEILING case, how many of the first blocks must still agree within TOL (the part of the page that does not depend on the data or the role).
const LEAD: Record<string, number> = {
  "console audit@1568": 1,
  "console audit@768": 1,
  "console audit@390": 1,
  "rosters week@1568": 2, // head + the week board
  "rosters week@768": 1,
  "rosters week@390": 1,
  "rosters supervisor@1568": 1,
  "rosters supervisor@768": 1,
  "rosters staff@1568": 1,
  "rosters staff@768": 1,
  "roster locations@1568": 1,
  "roster locations@768": 1,
  "roster locations@390": 1,
  "location form coppers@1568": 2,
  "location form coppers@768": 2,
  "location form coppers@390": 2,
  "location form liffey@768": 1,
  "location form liffey@390": 1,
  "my roster staff@1568": 2,
  "my roster staff@768": 2,
  "my roster staff@390": 2
}

const ROSTER_RX = "^/v1/(roster|locations|leave|shift-types|members/[^/]+/qualifications)"
const locationPath = async (name: string) => {
  const a = await apiAs("owner")
  const { items }: { items: { id: string; name: string }[] } = await a.get("/v1/locations")
  await a.ctx.dispose()
  return `/rosters/locations/${items.find((l) => l.name === name)!.id}`
}

type Case = { name: string; as: Persona; path: string | (() => Promise<string>); rx: string; tol?: number }
const CASES: Case[] = [
  { name: "dashboard manager", as: "owner", path: "/", rx: "^/v1/dashboard" },
  { name: "dashboard staff", as: "member", path: "/", rx: "^/v1/dashboard" },
  { name: "reports inbox", as: "owner", path: "/daily-reports", rx: "^/v1/shift-reports" },
  { name: "reports member", as: "member", path: "/daily-reports", rx: "^/v1/shift-reports" },
  { name: "report review", as: "owner", path: async () => { const a = await apiAs("owner"); const r = (await a.get("/v1/shift-reports?limit=50&status=accepted")).items.find((x: { id: string | null }) => x.id) ?? (await a.get("/v1/shift-reports?limit=50")).items.find((x: { id: string | null }) => x.id); return `/daily-reports/${r.id}` }, rx: "^/v1/shift-reports" },
  { name: "shifts week", as: "owner", path: "/shifts", rx: "^/v1/shifts" },
  { name: "shifts member", as: "member", path: "/shifts", rx: "^/v1/shifts" },
  { name: "tasks list", as: "owner", path: "/tasks", rx: "^/v1/tasks" },
  { name: "task detail", as: "owner", path: "/tasks/TSK-1001", rx: "^/v1/tasks" },
  { name: "billing", as: "owner", path: "/settings/billing", rx: "^/v1/billing/invoices" },
  { name: "audit", as: "owner", path: "/audit-log", rx: "^/v1/audit" },
  // The console: only the page's own reads are held back (the layout's probe is /v1/platform/tenants?pageSize=1, which must answer for the real shell to appear).
  { name: "console overview", as: "platform", path: "/platform", rx: "^/v1/platform/(metrics|audit|data-requests)" },
  { name: "console tenants", as: "platform", path: "/platform/tenants", rx: "^/v1/platform/tenants(?!\\?pageSize=1$)" },
  { name: "console audit", as: "platform", path: "/platform/audit", rx: "^/v1/platform/audit" },
  { name: "account security", as: "member", path: "/account/security", rx: "^/v1/me/sessions" },
  // Location Rosters (B8 Task 25): only the roster reads are held back (the shell's own reads answer at once).
  { name: "rosters week", as: "owner", path: "/rosters", rx: ROSTER_RX },
  { name: "rosters supervisor", as: "ismail", path: "/rosters", rx: ROSTER_RX },
  { name: "rosters staff", as: "member", path: "/rosters", rx: ROSTER_RX },
  { name: "roster locations", as: "owner", path: "/rosters/locations", rx: ROSTER_RX },
  { name: "location form coppers", as: "owner", path: () => locationPath("Coppers"), rx: ROSTER_RX },
  { name: "location form liffey", as: "owner", path: () => locationPath("Liffey Retail Park"), rx: ROSTER_RX },
  { name: "my roster office", as: "owner", path: "/rosters/mine", rx: ROSTER_RX },
  { name: "my roster staff", as: "member", path: "/rosters/mine", rx: ROSTER_RX },
]

const sig = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const m = document.querySelector("main")!
    const r1 = (n: number) => Math.round(n * 10) / 10
    const top = m.getBoundingClientRect().top
    // The page's own height (not main's, which has a viewport-high minimum): the lowest bottom of anything visible in it.
    let bottom = top
    for (const el of m.querySelectorAll("*")) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.width > 0 && !el.closest(".sr-only") && !(el as HTMLElement).className?.toString().includes("sr-only")) bottom = Math.max(bottom, r.bottom)
    }
    // The page's blocks: the outermost head, stat row, card, grid, table and pager, in document order (a skeleton and its page use the same classes).
    const SEL = ".head, .stats, .card, .table-wrap, .od-pager, [class*=grid-], .today, .od-filters, .filters"
    const all = [...m.querySelectorAll(SEL)]
    const blocks = all.filter((e) => !all.some((o) => o !== e && o.contains(e))).filter((e) => e.getBoundingClientRect().height > 0)
    return { main: r1(bottom - top), blocks: blocks.map((k) => ({ c: (typeof (k as HTMLElement).className === "string" ? (k as HTMLElement).className : "").split(" ").filter((x) => x && !x.startsWith("sk")).slice(0, 2).join("."), h: r1(k.getBoundingClientRect().height) })) }
  })

for (const width of [1568, 768, 390]) {
  test.describe(`skeleton parity at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const c of CASES) {
      test(c.name, async ({ as }) => {
        const page = await as(c.as)
        const path = typeof c.path === "string" ? c.path : await c.path()
        await fetch(`${SLOW}/__delay/2500/${encodeURIComponent(c.rx)}`)
        try {
          await page.goto(path, { waitUntil: "commit" })
          await page.waitForSelector("main .sk, main [class*=sk-]", { timeout: 15_000 })
          await page.waitForTimeout(1300) // past the shell-level skeleton, on the route's own loading.tsx
          const sk = await sig(page)
          await fetch(`${SLOW}/__delay/0`)
          await page.waitForFunction(() => !document.querySelector("main .sk"), null, { timeout: 45_000 })
          await page.waitForTimeout(1600) // past the entrance animation of the cards
          const real = await sig(page)
          const diffs = sk.blocks.length === real.blocks.length ? sk.blocks.map((b, i) => Math.round((b.h - real.blocks[i].h) * 10) / 10) : null
          appendFileSync("test-results/skeleton-measurements.jsonl", `${JSON.stringify({ width, name: c.name, skeleton: sk, loaded: real, totalDiff: Math.round((sk.main - real.main) * 10) / 10, blockDiffs: diffs })}\n`)
          if (process.env.SKELETON_RECORD === "1") return // survey mode: measure only
          const key = `${c.name}@${width}`
          if (EXACT[c.name]?.includes(width)) {
            expect(Math.abs(sk.main - real.main), `${key}: total ${sk.main} vs ${real.main}`).toBeLessThanOrEqual(TOL)
            expect(sk.blocks.length, `${key}: the same number of blocks (${sk.blocks.map((b) => b.c)} vs ${real.blocks.map((b) => b.c)})`).toBe(real.blocks.length)
            diffs?.forEach((d, i) => expect(Math.abs(d), `${key}: block ${i} ${sk.blocks[i].c} ${sk.blocks[i].h} vs ${real.blocks[i].h}`).toBeLessThanOrEqual(TOL))
          } else {
            const ceiling = CEILING[key]
            expect(ceiling, `${key}: no measured ceiling: add it (or make it exact)`).toBeDefined()
            expect(Math.abs(sk.main - real.main), `${key}: total ${sk.main} vs ${real.main}`).toBeLessThanOrEqual(ceiling)
            for (let i = 0; i < (LEAD[key] ?? 0); i++) expect(Math.abs(sk.blocks[i].h - real.blocks[i].h), `${key}: lead block ${i} ${sk.blocks[i].c} ${sk.blocks[i].h} vs ${real.blocks[i]?.h}`).toBeLessThanOrEqual(TOL)
          }
        } finally {
          await fetch(`${SLOW}/__delay/0`)
        }
      })
    }
  })
}
