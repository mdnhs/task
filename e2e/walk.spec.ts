import { expect, test } from "./fixtures"
import type { Page } from "@playwright/test"

// The browser walk (T6.9): states and behaviours a unit test cannot see, on the real stack. Light and dark, phone and desktop; read-only roles; the export download; the conflict banner;
// the tenant switch clearing what it must.
const PAGES = ["/", "/tasks", "/tasks/TSK-1001", "/daily-reports", "/shifts", "/settings/users", "/settings/devices", "/audit-log", "/account/security"]

async function watch(page: Page) {
  const problems: string[] = []
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|\[HMR\]|Download the React DevTools/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`) })
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`))
  return problems
}

for (const theme of ["light", "dark"] as const) {
  for (const [label, width] of [["desktop", 1440], ["phone", 390]] as const) {
    test(`${theme} ${label}: pages render without console errors, hydration warnings or sideways scroll`, async ({ as }) => {
      const page = await as("owner")
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript((t) => { try { localStorage.setItem("theme", t) } catch { /* blocked */ } }, theme)
      const problems = await watch(page)
      for (const path of PAGES) {
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        await expect(page.locator("main .sk")).toHaveCount(0) // the loading skeleton has been replaced
        const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark")
        expect(isDark, `${path} theme`).toBe(theme === "dark")
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect(overflow, `${path} sideways scroll at ${width}`).toBeLessThanOrEqual(1)
      }
      expect(problems).toEqual([])
    })
  }
}

test("read-only role (auditor): the data is there and every write control is not", async ({ as }) => {
  const page = await as("auditor")
  await page.goto("/tasks")
  await expect(page.getByText("TSK-1001")).toBeVisible()
  await expect(page.getByRole("link", { name: "New task" })).toHaveCount(0)
  await page.goto("/tasks/TSK-1001")
  await expect(page.getByRole("button", { name: /Reschedule|Reassign|Remove|Complete/ })).toHaveCount(0)
  await page.goto("/shifts")
  await expect(page.getByRole("button", { name: "New pattern" })).toHaveCount(0)
  await expect(page.getByRole("switch")).toHaveCount(0)
})

test("hover on a table row changes the text colour only, never the background (light and dark)", async ({ as }) => {
  const page = await as("owner")
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((t) => { try { localStorage.setItem("theme", t) } catch { /* blocked */ } }, theme)
    await page.goto("/tasks")
    const row = page.locator("table.tasks-table tbody tr").first()
    await expect(row).toBeVisible()
    const bg = () => row.evaluate((e) => getComputedStyle(e).backgroundColor + "|" + getComputedStyle(e.querySelector("td")!).backgroundColor)
    const before = await bg()
    await row.hover()
    await page.waitForTimeout(400)
    expect(await bg(), `${theme}: hover must not paint a background`).toBe(before)
  }
})

test("export: PDF, Excel and CSV are made by a server job and downloaded", async ({ as }) => {
  const page = await as("owner")
  await page.goto("/daily-reports")
  for (const [label, ext] of [["CSV", /\.csv$/], ["Excel", /\.xlsx$/], ["PDF", /\.pdf$/]] as const) {
    await page.getByRole("button", { name: "Export", exact: true }).first().click()
    const dl = page.waitForEvent("download", { timeout: 60_000 })
    await page.getByRole("menuitem", { name: label }).click()
    const file = await dl
    expect(file.suggestedFilename()).toMatch(ext)
    const path = await file.path()
    expect(path).toBeTruthy()
    const { statSync } = await import("node:fs")
    expect(statSync(path!).size).toBeGreaterThan(100)
  }
})

test("tenant switch: recent searches do not follow the person into the other company", async ({ as }) => {
  const page = await as("owner")
  await page.goto("/tasks")
  await page.evaluate(() => localStorage.setItem("od-search-recents", JSON.stringify(["TSK-1001"])))
  await page.getByRole("button", { name: "Account menu" }).click()
  await page.getByText("Switch company").click()
  await page.getByRole("menuitem", { name: /Harbourline/ }).dispatchEvent("click") // the submenu re-renders under the pointer; the click is what the user means
  await expect.poll(() => page.evaluate(() => localStorage.getItem("od-search-recents")), { timeout: 30_000 }).toBeNull()
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible()
  await page.goto("/") // the company is now Harbourline
  await expect(page.getByText(/Harbourline Cleaning Co/).first()).toBeVisible()
})

test("report draft conflict: Keep mine, Reload theirs, and the banner when theirs cannot be fetched", async ({ as }) => {
  const ops = await (await import("./fixtures")).apiAs("ops")
  const people: { userId: string; name: string }[] = await ops.get("/v1/people?limit=100")
  await ops.send("PUT", `/v1/shifts/reporting/people/${people.find((p) => p.name === "Ismail Rahman")!.userId}`, { on: true })
  const a = await as("ismail")
  const b = await as("ismail")
  for (const p of [a, b]) {
    await p.goto("/daily-reports")
    await p.getByRole("link", { name: "Open my report" }).click()
    await expect(p.getByLabel(/^Summary/)).toBeVisible()
  }
  // A saves first.
  await a.getByLabel(/^Summary/).fill("Written in the first tab.")
  await a.getByRole("button", { name: "Save draft" }).click()
  await expect(a.getByText("Draft saved")).toBeVisible()
  // B saves second from the same version: 409, its text is kept and it must choose.
  await b.getByLabel(/^Summary/).fill("Written in the second tab.")
  await b.getByLabel(/^Notes for the next shift/).fill("Handover from the second tab.") // so the submit below gets past the required-field check
  await b.getByRole("button", { name: "Save draft" }).click()
  await expect(b.getByText("Your text is kept.")).toBeVisible()
  await expect(b.getByLabel(/^Summary/)).toHaveValue("Written in the second tab.")
  // Submitting while the banner is open is refused until a choice is made.
  await b.getByRole("button", { name: "Submit" }).click()
  await expect(b.getByText("Choose Keep mine or Reload theirs first.")).toBeVisible()
  // Reload theirs takes the other tab's text.
  await b.getByRole("button", { name: "Reload theirs" }).click()
  await expect(b.getByLabel(/^Summary/)).toHaveValue("Written in the first tab.")
  await expect(b.getByText("Your text is kept.")).toHaveCount(0)
  // Conflict again; this time theirs cannot be loaded (the API answers 500): the banner still shows, with its own copy, and Keep mine still works.
  await a.getByLabel(/^Summary/).fill("Second edit in the first tab.")
  const saved = a.waitForResponse((r) => r.request().method() === "PUT" && /\/draft$/.test(r.url()) && r.status() === 200)
  await a.getByRole("button", { name: "Save draft" }).click()
  await saved
  await b.route(/\/v1\/shift-reports\/[0-9a-f-]{36}$/, (r) => r.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, requestId: "e2e" }) }))
  await b.getByLabel(/^Summary/).fill("Edit in the second tab.")
  await b.getByRole("button", { name: "Save draft" }).click()
  await expect(b.getByText("Their version could not be loaded: try again.")).toBeVisible()
  await b.unroute(/\/v1\/shift-reports\/[0-9a-f-]{36}$/)
  await b.getByRole("button", { name: "Keep mine" }).click()
  await expect(b.getByText(/Your text is kept\./)).toHaveCount(0)
  await expect(b.getByLabel(/^Summary/)).toHaveValue("Edit in the second tab.")
})
