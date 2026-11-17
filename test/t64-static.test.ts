import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// Source-level guards for T6.4 (no DOM in this suite, so these read the files).
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
const sources = ["app", "features", "lib", "components", "hooks", "packages", "test"].flatMap((d) => walk(d)).filter((f) => f !== "test/t64-static.test.ts")
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("T6.4 the client outboxes are gone", () => {
  test("lib/notify-data, lib/task-notices, lib/audit-outbox and the mock feed hook no longer exist", () => {
    for (const f of ["lib/notify-data.ts", "lib/task-notices.ts", "lib/audit-outbox.ts", "lib/audit-outbox.test.ts", "hooks/use-notify-feed.ts", "packages/domain/src/task-notices.ts", "packages/domain/src/task-notices.test.ts"]) expect(exists(f), f).toBe(false)
  })

  test("nothing imports them, and nothing mentions their stores", () => {
    const offenders: string[] = []
    for (const f of sources) {
      const src = strip(read(f))
      if (/(notify-data|task-notices|audit-outbox|use-notify-feed)["']/.test(src)) offenders.push(`${f}: imports a deleted module`)
      if (/\b(taskNotices|noticeFeedItems|noticeTitle|getNotifyContext|notifyFeed|useNotifyFeed|OutboxAuditEvent|mergeOutbox)\b/.test(src)) offenders.push(`${f}: uses a deleted symbol`)
      if (/\bauditOutbox\b/.test(src) && !f.startsWith("features/platform/")) offenders.push(`${f}: auditOutbox outside the console's own mock store`)
    }
    expect(offenders).toEqual([])
  })
})

describe("T6.4 the shell takes its data from the API", () => {
  test("the (app) layout composes org, banner and bell from the API: no mock notifications, no people lookup, no notify context", () => {
    const layout = strip(read("app/(app)/layout.tsx"))
    expect(layout).toContain("getOrg()")
    expect(layout).not.toMatch(/getNotifyContext|getNotifications|getPeople|todayUserId/)
    expect(layout).toContain("BillingBanner")
    expect(layout).toMatch(/org\.departments/) // the department filter is the tenant's, not navigation.json's
  })

  test("the layout does not read tenant data before the second factor is in order (the API would answer 401 mfa_*)", () => {
    const layout = strip(read("app/(app)/layout.tsx"))
    expect(layout).toMatch(/session\.mfa === "ok"/)
    expect(layout).toContain("neutralOrg")
  })

  test("tenant values never appear as literals in the code paths that serve real tenants", () => {
    for (const f of ["lib/org-core.ts", "lib/org.ts", "lib/people.ts", "lib/billing-state.ts", "lib/notifications.ts", "lib/tz.ts", "features/billing/adapters.ts", "features/billing/client.ts", "features/billing/api.ts", "components/billing-banner.tsx", "features/billing/components/billing-view.tsx", "app/(app)/layout.tsx"]) {
      expect(strip(read(f)), f).not.toMatch(/Europe\/Dublin|["'`]EUR["'`]|en-IE|Irish time/)
    }
  })

  test("the real getOrg and getPeople read only endpoints a plain member may call", () => {
    const core = read("lib/org-core.ts")
    for (const banned of ["/v1/settings", "/v1/audit", "/v1/roles", "/v1/members", "/v1/billing"]) expect(core, banned).not.toContain(banned)
    expect(core).toContain("/v1/me/tenant")
    expect(core).toContain("/v1/teams")
  })

  test("not-yet-switched pages keep the mock org and people through explicit names (greppable for T6.5 to T6.8)", () => {
    expect(read("lib/org.ts")).toContain("export async function getMockOrg")
    expect(read("lib/people.ts")).toContain("export async function getMockPeople")
    expect(read("lib/org.ts")).toMatch(/MOCK/)
  })
})

describe("T6.4 the bell", () => {
  test("it is driven by the API through useNotifications and the polling helper, with no client-side generator", () => {
    const panel = read("features/shell/components/notifications-panel.tsx")
    expect(panel).toContain("useNotifications")
    expect(panel).not.toMatch(/useNotifyFeed|noticeFeedItems|dueReminders|clockAt|createStore/)
    const hook = read("hooks/use-notifications.ts")
    expect(hook).toContain("startPolling")
    expect(hook).toContain("apiBrowser")
    expect(hook).toMatch(/"use client"/)
  })

  test("the settings preview keeps its own mock clock store, outside the bell", () => {
    expect(exists("hooks/notify-clock.ts")).toBe(true)
    expect(read("features/settings/components/notifications-panel.tsx")).toContain("@/hooks/notify-clock")
  })
})

describe("T6.4 skeletons stay static and mirror the components", () => {
  test("the bell has a loading state built from the real row classes with Sk", () => {
    const sk = read("features/shell/components/skeletons.tsx")
    expect(sk).toContain("export function NotificationsListSkeleton")
    const body = sk.slice(sk.indexOf("export function NotificationsListSkeleton"))
    expect(body).toContain("od-notif-row")
    expect(body).toContain("od-notif-ico")
    expect(read("features/shell/components/notifications-panel.tsx")).toContain("NotificationsListSkeleton")
  })

  test("the billing banner has a skeleton built from the real banner class and no API or session read", () => {
    const f = read("components/billing-banner.tsx")
    expect(f).toContain("export function BillingBannerSkeleton")
    expect(f).toContain("sub-banner")
    expect(f.slice(f.indexOf("export function BillingBannerSkeleton"))).toContain("Sk")
    expect(f).not.toMatch(/lib\/session|apiServer|getSession/)
  })

  test("the billing skeleton mirrors the new view: a seats card instead of the usage card, a View link instead of Download", () => {
    const sk = read("features/billing/components/skeletons.tsx")
    const view = read("features/billing/components/billing-view.tsx")
    expect(view).toContain('id="bill-seats-h"')
    expect(view).not.toContain("USAGE_ROWS")
    expect(sk).toContain("bill-seats")
    expect(sk).not.toContain("USAGE_ROWS")
    expect(sk).not.toMatch(/lib\/session|apiServer|getBilling|getSession/)
  })

  test("the settings loading never calls the API for billing: it passes static plan data only", () => {
    const l = strip(read("app/(app)/settings/[tab]/loading.tsx"))
    expect(l).not.toMatch(/getBilling\(|getOrg\(|getPeople\(/)
  })
})

describe("T6.4 billing stays usable while blocked", () => {
  test("the settings page gates billing and the data export on the role (canWhileBlocked), not on canWrite", () => {
    const page = strip(read("app/(app)/settings/[tab]/page.tsx"))
    expect(page).toContain("canWhileBlocked(session, \"billing\")")
    expect(page).toContain("canWhileBlocked(session, \"export\")")
    expect(page).toContain("requireMfaOk()")
  })
})

describe("T6.4 a 403 module_not_entitled renders the 'Not in your plan' state", () => {
  test("AccessRestricted can be forced into the plan variant by the API's answer, and the shell exports the helper pages use", () => {
    const ar = read("features/shell/components/access-restricted.tsx")
    expect(ar).toContain("notInPlan")
    expect(ar).toContain("Not in your plan")
    const helper = read("features/shell/components/api-failure.tsx")
    expect(helper).toContain("gateOf")
    expect(helper).toContain("<AccessRestricted")
    expect(read("features/shell/index.ts")).toContain("apiFailureView")
  })
})
