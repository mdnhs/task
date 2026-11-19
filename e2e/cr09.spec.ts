import { readFileSync } from "node:fs"
import { apiAs, expect, test } from "./fixtures"
import { statePath } from "./paths"
import { ROSTER, rosterIds, rosterWeeks } from "./world"

type Har = { log: { entries: { request: { url: string }; response: { status: number; content: { text?: string; encoding?: string } } }[] } }
const bodyOf = (c: { text?: string; encoding?: string }) => (c.text ? (c.encoding === "base64" ? Buffer.from(c.text, "base64").toString("utf8") : c.text) : "")

// CR-09 / AC-RS-03 (FR-RS-30..34): roster rights are per location. The world's supervisor (Grace Mensah) holds one grant, Quayside Depot; Harbour Gate is another site with a week of
// its own. She sees and edits Quayside only; Harbour Gate's URL answers "no access" and its name never reaches her browser: not in the page text, not in any network response (the HAR,
// read after the context closes). The office roster manager sees every location.
test("CR-09 (AC-RS-03): the supervisor sees and edits only their location; another location's URL says no access and its name never appears in the page text or network responses (read the HAR for the other name); an office roster manager sees every location", async ({ browser, baseURL }, testInfo) => {
  const { quayside, harbour } = await rosterIds()
  const W = rosterWeeks()
  const har = testInfo.outputPath("supervisor.har")
  const ctx = await browser.newContext({ baseURL, storageState: statePath(ROSTER.supervisor), viewport: { width: 1440, height: 900 }, recordHar: { path: har, content: "embed" } })
  const page = await ctx.newPage()
  const texts: string[] = []
  const visit = async (path: string) => {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    texts.push(await page.locator("body").innerText())
  }

  // Her roster: one location, no switcher, and she can edit its draft weeks (the add buttons are there).
  await visit("/rosters")
  await expect(page.getByRole("heading", { name: ROSTER.quayside })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Location" })).toHaveCount(0)
  await visit(`/rosters?location=${quayside}&week=${W.rest}`)
  const block = page.getByRole("region", { name: ROSTER.quayside })
  await expect(block.getByText("Draft", { exact: true })).toBeVisible()
  await expect(block.getByRole("button", { name: /^Add shift on / })).toHaveCount(7)
  await expect(block.getByRole("button", { name: "Check rules" })).toBeVisible()
  // The other site: by URL it is "no access", like a place that does not exist; so are its admin page and the locations list (office only).
  await visit(`/rosters?location=${harbour}&week=${W.cr07}`)
  await expect(page.getByRole("heading", { name: "Access restricted", level: 1 })).toBeVisible()
  await visit(`/rosters/locations/${harbour}`)
  await expect(page.getByRole("heading", { name: "Access restricted", level: 1 })).toBeVisible()
  await visit("/rosters/locations")
  await expect(page.getByRole("heading", { name: "Access restricted", level: 1 })).toBeVisible()
  await visit("/rosters/mine")
  await expect(page.getByRole("heading", { name: "My roster" })).toBeVisible()
  // The API refuses her too: Harbour Gate's week is a 404 (the same as a missing one), and so is an edit there.
  const ops = await apiAs("ops")
  const hw = (await ops.get(`/v1/roster/weeks?locationId=${harbour}&from=${W.cr07}`)).weeks[0]
  const shiftType = (await ops.get(`/v1/locations/${harbour}/shift-types`)).items[0].id
  await ops.ctx.dispose()
  for (const [method, path, data] of [["GET", `/v1/roster/weeks/${hw.id}`, undefined], ["POST", `/v1/roster/weeks/${hw.id}/shifts`, { shifts: [{ date: W.cr07, userIds: [null], shiftTypeId: shiftType }] }]] as const) {
    const r = await page.request.fetch(path, { method, data, headers: { origin: baseURL! } })
    expect(r.status(), `${method} ${path}`).toBe(404)
    expect(await r.text()).not.toContain(ROSTER.harbour)
  }
  await ctx.close() // writes the HAR

  for (const t of texts) expect(t).not.toContain(ROSTER.harbour)
  const entries = (JSON.parse(readFileSync(har, "utf8")) as Har).log.entries
  const bodies = entries.map((e) => ({ url: e.request.url, body: bodyOf(e.response.content) }))
  expect(bodies.some((b) => b.body.includes(ROSTER.quayside)), "the HAR holds the response bodies (her own site is in them)").toBe(true)
  expect(bodies.filter((b) => b.body.includes(ROSTER.harbour)).map((b) => b.url), "responses naming the other site").toEqual([])
  // Its id only ever comes back in the answer to the URL she typed herself (the router echoes the address); nothing else carries it.
  expect(bodies.filter((b) => !b.url.includes(harbour) && b.body.includes(harbour)).map((b) => b.url), "responses carrying the other site's id").toEqual([])

  // The office roster manager: every location, Harbour Gate's week included.
  const office = await (await browser.newContext({ baseURL, storageState: statePath("ops"), viewport: { width: 1440, height: 900 } })).newPage()
  await office.goto("/rosters")
  await office.getByRole("combobox", { name: "Location" }).click()
  for (const name of [ROSTER.quayside, ROSTER.harbour, "Coppers", "Docklands Plaza", "Liffey Retail Park"]) await expect(office.getByRole("option", { name })).toBeVisible()
  await office.keyboard.press("Escape")
  await office.goto(`/rosters?location=${harbour}&week=${W.cr07}`)
  await expect(office.getByRole("region", { name: ROSTER.harbour }).locator(".ros-shift")).toHaveCount(1)
  await office.context().close()
})

// AC-RS-05 (FR-RS-35..37): once the supervisor publishes, the week is locked for them: no add, edit, drag, check or publish, only "Request change"; the API refuses a direct edit
// from their own session (403 roster_locked). The office roster manager edits the published week with a reason, and the change is in the week's history with that reason.
test("AC-RS-05: after the supervisor publishes, every edit control is disabled and a direct API PATCH by their session returns 403; the office manager edits with a reason and the entry appears in history", async ({ as, baseURL }) => {
  const { quayside } = await rosterIds()
  const W = rosterWeeks()
  const url = `/rosters?location=${quayside}&week=${W.lock}`
  const page = await as(ROSTER.supervisor)
  await page.goto(url)
  const block = page.getByRole("region", { name: ROSTER.quayside })
  await expect(block.getByRole("button", { name: /^Edit shift, / })).toHaveCount(2)
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const pub = page.getByRole("dialog", { name: /^Publish / })
  await pub.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Week published")).toBeVisible()
  await expect(block.getByRole("img", { name: "Published and locked: read-only" })).toBeVisible()
  // Every edit control is gone, and a reload (the server's own answer) agrees.
  for (const fresh of [false, true]) {
    if (fresh) await page.reload()
    await expect(block.getByRole("img", { name: "Published and locked: read-only" })).toBeVisible()
    await expect(block.getByRole("button", { name: /^Edit shift, / })).toHaveCount(0)
    await expect(block.getByRole("button", { name: /^Add shift on / })).toHaveCount(0)
    await expect(block.getByRole("button", { name: /^(Check rules|Publish|Start week)/ })).toHaveCount(0)
    await expect(block.locator(".dnd-card")).toHaveCount(0)
    await expect(block.getByRole("button", { name: /^Request change, / })).toHaveCount(2)
  }
  // Their own session, straight at the API: refused.
  const shiftId = await block.locator(".ros-shift", { hasText: ROSTER.staff.tomasz }).getAttribute("data-shift-id")
  const week = await (await page.request.get(`/v1/roster/weeks?locationId=${quayside}&from=${W.lock}`)).json()
  const shift = week.shifts.find((s: { id: string }) => s.id === shiftId)
  const res = await page.request.patch(`/v1/roster/shifts/${shiftId}`, { data: { version: shift.version, patch: { start: "09:00" } }, headers: { origin: baseURL! } })
  expect(res.status()).toBe(403)
  expect((await res.json()).code).toBe("roster_locked")

  // The office roster manager edits it, with a reason; the history shows the change and the reason.
  const office = await as("ops")
  await office.goto(url)
  const oblock = office.getByRole("region", { name: ROSTER.quayside })
  await oblock.getByRole("button", { name: `Edit shift, ${ROSTER.staff.tomasz}, 08:00 to 16:00` }).click()
  const dialog = office.getByRole("dialog", { name: "Edit shift" })
  await office.getByRole("combobox", { name: "End" }).click()
  await office.locator(".od-time").getByRole("listbox", { name: "Hour" }).getByRole("option", { name: "5", exact: true }).click()
  await office.keyboard.press("Escape")
  await dialog.getByRole("button", { name: "Save changes" }).click()
  const why = office.getByRole("dialog", { name: "Save changes" })
  await expect(why.getByText("This week is published. Give a reason; the person will need to confirm again.")).toBeVisible()
  await why.getByLabel("Reason").fill("Client asked for a later finish")
  await why.getByRole("button", { name: "Save changes" }).click()
  await expect(office.getByText("Shift saved")).toBeVisible()
  await expect(oblock.locator(".ros-shift", { hasText: ROSTER.staff.tomasz })).toContainText("08:00–17:00")
  // The history panel is the server's first page: it is read again on the next load (an edit re-reads the week, not the panels).
  await office.reload()
  const history = office.getByRole("region", { name: "Roster history" })
  const row = history.locator(".ros-hist-row").first()
  await expect(row.locator(".ros-who")).toHaveText(new RegExp(`^Changed a shift · ${ROSTER.staff.tomasz}, `))
  await expect(row.locator(".ros-role")).toHaveText("Client asked for a later finish")
  await expect(row.locator(".ros-time")).toContainText("Lilianna Novak")
})
