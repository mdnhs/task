import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { BackLink } from "@/components/back-link"
import type { Live360 } from "./adapters"
import { LiveOverviewTab, subscriptionPill } from "./components/live-360"
import { OverviewDashboard } from "./components/overview-dashboard"
import { LiveOverviewSkeleton } from "./components/live-skeletons"
import type { OverviewData } from "./overview"

const css = readFileSync(join(process.cwd(), "app/styles/platform.css"), "utf8")
const rule = (sel: string): string => new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()]/g, "\\$&")}\\{([^}]*)\\}`).exec(css)?.[1] ?? ""

const at = "2026-01-01T00:00:00.000Z"
const T: Live360 = {
  id: "00000000-0000-0000-0000-000000000000", slug: "company", name: "Company", status: "active", suspended: false, timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", createdAt: at,
  planId: "business", plan: "Business", subscriptionStatus: "past_due", seats: 40, seatsUsed: 10, memberCount: 10, trialEndsAt: null, currentPeriodEnd: at, cancelAtPeriodEnd: false, hasProviderSubscription: true,
  overrides: [], lastActivityDate: "2026-01-01", openDataRequests: 0,
}
const DATA: OverviewData = {
  monthLabel: "Jan 2026", kpis: [], revenue: { currency: "EUR", series: [] },
  planMix: [{ id: "p", name: "Plan", paying: 1, trials: 0, total: "€1", share: 10, shareLabel: "10%" }],
  attention: [], activity: [{ id: "e", at, actor: "A", action: "x.y", target: "T", detail: "d" }],
}

describe("console overview layout: one gap token, two aligned columns", () => {
  test("the gap between stacked sections and columns is one token", () => {
    expect(css).toMatch(/:root\{--pf-gap:calc\(16px \* var\(--space-scale,1\)\)\}/)
    for (const sel of [".pf-ov-grid", ".pf-ov-col", ".pf-sample"]) expect(rule(sel)).toContain("gap:var(--pf-gap)")
    expect(rule(".pf-ov-grid")).toContain("align-items:stretch")
  })
  test("the sample cards are two column stacks inside ONE grid (never two grids stacked with no gap)", () => {
    const html = renderToStaticMarkup(createElement(OverviewDashboard, { data: DATA, today: "2026-01-01", tzLabel: "Irish time", sample: true }))
    expect(html.match(/class="pf-ov-grid"/g)).toHaveLength(1)
    expect(html.match(/class="pf-ov-col"/g)).toHaveLength(2)
  })
  test("the overview skeleton has the same grid", () => {
    expect(renderToStaticMarkup(createElement(LiveOverviewSkeleton))).toContain("Loading overview")
  })
  test("long text wraps inside the cards", () => {
    expect(rule(".pf-att-main")).toContain("min-width:0")
    expect(rule(".pf-recent .tt")).toContain("overflow-wrap:anywhere")
    expect(rule(".pf-aud-main")).toContain("flex-wrap:wrap")
  })
})

describe("back links use the ArrowLeft01 icon", () => {
  test("BackLink: decorative svg icon + the visible label, no text arrow", () => {
    const html = renderToStaticMarkup(createElement(BackLink, { href: "/platform/tenants" } as React.ComponentProps<typeof BackLink>, "Tenants"))
    expect(html).toContain('class="pf-back"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).toContain(">Tenants<")
    expect(html).not.toContain("←")
  })
  test("no text-arrow back link is left in the console", () => {
    const left: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx$/.test(n) && /className="pf-back"[^>]*>\s*←|>←\s/.test(readFileSync(p, "utf8"))) left.push(p)
      }
    }
    walk(join(process.cwd(), "features/platform"))
    walk(join(process.cwd(), "app/(platform)"))
    expect(left).toEqual([])
  })
})

describe("tenant 360 Overview tab is grouped and humanised", () => {
  test("past_due reads Past due, never the raw word", () => {
    expect(subscriptionPill("past_due")).toEqual({ tone: "warn", label: "Past due" })
    expect(subscriptionPill("trialing").label).toBe("Trial")
    expect(subscriptionPill(null).label).toBe("None")
    expect(subscriptionPill("some_new_state").label).toBe("Some new state")
  })
  test("three groups, a status pill, seats as N of M with a bar", () => {
    const html = renderToStaticMarkup(createElement(LiveOverviewTab, { t: T }))
    for (const g of ["Subscription", "Usage", "Tenant"]) expect(html).toContain(`aria-label="${g}"`)
    expect(html).toContain("Past due")
    expect(html).not.toContain("past_due")
    expect(html).toContain("of 40")
    expect(html).toContain('aria-label="10 of 40 seats used"')
    expect(html).toContain("Counts only. Member details stay in the tenant.")
  })
  test("unlimited seats show a count and no bar", () => {
    const html = renderToStaticMarkup(createElement(LiveOverviewTab, { t: { ...T, seats: null } }))
    expect(html).toContain("10 used")
    expect(html).not.toContain("pf-dl-bar")
  })
  test("the groups are borderless and collapse to one column on phones (auto-fit, min 260px)", () => {
    expect(rule(".pf-dl-groups")).toContain("repeat(auto-fit,minmax(min(100%,260px),1fr))")
    expect(rule(".pf-dl-group")).not.toMatch(/border(?!-radius)/)
  })
})

describe("console overview: the two column stacks end on the same line", () => {
  test("grid items stretch and the last card of each column grows", () => {
    expect(rule(".pf-ov-grid")).toContain("align-items:stretch")
    expect(rule(".pf-ov-col>:last-child")).toContain("flex:1 1 auto")
  })
})

describe("platform lists: filter tabs and search share one toolbar row", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), "features/platform/components", f), "utf8")
  test.each(["live-tenants.tsx", "billing-ledger.tsx"])("%s renders tabs and search inside ONE FilterBar", (f) => {
    const s = src(f)
    expect(s.match(/<FilterBar>/g)).toHaveLength(1)
    expect(s.indexOf("<FilterSeg")).toBeGreaterThan(s.indexOf("<FilterBar>"))
    expect(s.indexOf("<FilterSearch")).toBeLessThan(s.indexOf("</FilterBar>"))
  })
  test("search follows the tabs with the normal filter-bar gap (no auto margin) and the tabs shrink before the row wraps", () => {
    expect(css).not.toMatch(/\.od-filter-search\{[^}]*margin-left/)
    expect(rule(".pf-card .od-filters .od-filter-search")).toBe("")
    const kit = readFileSync(join(process.cwd(), "app/styles/kit.css"), "utf8")
    expect(kit).toMatch(/\.od-filters\{[^}]*gap:10px/)
    expect(kit).not.toMatch(/\.od-filters[^{]*\.od-filter-search\{[^}]*margin-left/)
    expect(rule(".pf-card .od-filters .seg.od-seg")).toContain("min-width:0")
  })
})
