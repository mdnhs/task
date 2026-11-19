import type { Page, Request } from "@playwright/test"
import { apiAs, expect, test } from "./fixtures"
import { ROSTER, SECOND_OWNER, rosterIds, rosterWeeks } from "./world"

// B8 Task 25: the flows the reviewers of Tasks 21 and 24 could not reach on the demo seed, on purpose-built world state (e2e/world.ts): a supervisor's blocked publish, the office
// publishing and approving over a block (reason and rule ids sent together, the entry in history), history "Load more", and the last owner's Deactivate (409 last_owner) mapped in the UI.

/** The body of the next server action this page posts (the roster writes are server actions: the browser never calls /v1 for them). */
const nextAction = (page: Page, match: RegExp) => page.waitForRequest((r: Request) => r.method() === "POST" && !!r.headers()["next-action"] && match.test(r.postData() ?? ""))

test("blocked publish: the supervisor cannot publish a week that breaks a block rule (shown, Not publishable); the office publishes it with a reason, sent with the rule ids, and history keeps it", async ({ as, baseURL }) => {
  const { quayside } = await rosterIds()
  const monday = rosterWeeks().blocked
  const url = `/rosters?location=${quayside}&week=${monday}`
  const sup = await as(ROSTER.supervisor)
  await sup.goto(url)
  await sup.getByRole("button", { name: "Publish", exact: true }).click()
  const dialog = sup.getByRole("dialog", { name: /^Publish / })
  await expect(dialog.getByText("A rule is broken. Fix it, or ask the office to publish.")).toBeVisible()
  const row = dialog.getByRole("list", { name: "Rule breaks" }).getByRole("listitem").first()
  await expect(row).toHaveAttribute("data-kind", "block")
  await expect(row.locator("b").first()).toHaveText(ROSTER.staff.kone)
  await expect(row).toContainText("approved leave")
  await expect(dialog.getByRole("button", { name: "Not publishable" })).toBeDisabled()
  await expect(dialog.getByLabel("Reason to publish anyway")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  // The API says the same to the supervisor's own session, even with a reason.
  const weekId = await weekIdOf(quayside, monday)
  const version = (await (await sup.request.get(`/v1/roster/weeks/${weekId}`)).json()).weeks[0].version
  const refused = await sup.request.post(`/v1/roster/weeks/${weekId}/publish`, { data: { version, reason: "Trying", overrideRuleIds: ["approved_leave"] }, headers: { origin: baseURL! } })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).code).toBe("rule_blocked_office_required")

  // The office: a reason is required, then "Publish anyway" sends the reason AND the rule ids it goes over.
  const office = await as("ops")
  await office.goto(url)
  await office.getByRole("button", { name: "Publish", exact: true }).click()
  const od = office.getByRole("dialog", { name: /^Publish / })
  await expect(od.getByText("A rule is broken. Publishing anyway needs a reason.")).toBeVisible()
  await od.getByRole("button", { name: "Publish anyway" }).click()
  await expect(od.getByText("Give a reason to publish anyway")).toBeVisible()
  await od.getByLabel("Reason to publish anyway").fill("Leave cover agreed with Amara")
  const sent = nextAction(office, /Leave cover agreed with Amara/)
  await od.getByRole("button", { name: "Publish anyway" }).click()
  const body = (await sent).postData() ?? ""
  expect(body).toContain("\"reason\":\"Leave cover agreed with Amara\"")
  expect(body).toContain("\"overrideRuleIds\":[\"approved_leave\"]")
  await expect(office.getByText("Week published")).toBeVisible()
  await office.reload()
  const first = office.getByRole("region", { name: "Roster history" }).locator(".ros-hist-row").first()
  await expect(first.locator(".ros-who")).toHaveText("Published the week")
  await expect(first.locator(".ros-role")).toHaveText("Leave cover agreed with Amara")
})

test("approve over a block: the office approves a change request that breaks a block rule only with a reason; reason and rule ids go together and the history keeps the entry", async ({ as }) => {
  const { quayside } = await rosterIds()
  const monday = rosterWeeks().approve
  const page = await as("ops")
  await page.goto(`/rosters?location=${quayside}&week=${monday}`)
  const requests = page.getByRole("region", { name: "Change requests" })
  await expect(requests).toContainText("Swap agreed on the floor")
  await requests.getByRole("button", { name: "Approve" }).click()
  // Refused by the rule (Amara Kone is on approved leave that day): the reason dialog lists it.
  const why = page.getByRole("dialog", { name: "Go over the rule" })
  await expect(why.getByRole("list", { name: "Rule breaks" })).toContainText(ROSTER.staff.kone)
  await expect(why.getByRole("list", { name: "Rule breaks" })).toContainText("approved leave")
  await why.getByLabel("Reason").fill("Leave was moved, HR to update")
  const sent = nextAction(page, /Leave was moved, HR to update/)
  await why.getByRole("button", { name: "Approve anyway" }).click()
  const body = (await sent).postData() ?? ""
  expect(body).toContain("\"overrideReason\":\"Leave was moved, HR to update\"")
  expect(body).toContain("\"overrideRuleIds\":[\"approved_leave\"]")
  await expect(page.getByText("Change approved")).toBeVisible()
  const block = page.getByRole("region", { name: ROSTER.quayside })
  await expect(block.locator(".ros-day").nth(1).locator(".ros-shift")).toContainText(ROSTER.staff.kone)
  await expect(page.getByRole("region", { name: "Change requests" })).toHaveCount(0)
  await page.reload()
  const rows = page.getByRole("region", { name: "Roster history" }).locator(".ros-hist-row")
  await expect(rows.filter({ hasText: "Approved a change" })).toHaveCount(1)
  const changed = rows.filter({ hasText: `Changed a shift · ${ROSTER.staff.kone}` })
  await expect(changed).toHaveCount(1)
  await expect(changed.locator(".ros-role")).toHaveText("Swap agreed on the floor") // the request's own reason
  // The office's reason for going over the rule, and the rule it went over, are kept on that history entry (the panel shows the request's reason; the API keeps both).
  const weekId = await weekIdOf(quayside, monday)
  const items: { action: string; after: Record<string, unknown> | null }[] = (await (await page.request.get(`/v1/roster/weeks/${weekId}/history`)).json()).items
  const moved = items.find((h) => h.action === "shift_moved")!
  expect(moved.after).toMatchObject({ overrideReason: "Leave was moved, HR to update" })
  expect(JSON.stringify(moved.after)).toContain("approved_leave")
})

test("history Load more: a week with more than one page of history (26 lines, pages of 20) loads the rest by its cursor", async ({ as }) => {
  const { quayside } = await rosterIds()
  const page = await as("ops")
  await page.goto(`/rosters?location=${quayside}&week=${rosterWeeks().history}`)
  const panel = page.getByRole("region", { name: "Roster history" })
  const rows = panel.locator(".ros-hist-row")
  await expect(rows).toHaveCount(20)
  await expect(panel.locator(".ros-panel-head .ros-sum")).toHaveText("20+")
  await panel.getByRole("button", { name: "Load more" }).click()
  await expect(rows).toHaveCount(26)
  await expect(panel.locator(".ros-panel-head .ros-sum")).toHaveText("26")
  await expect(panel.getByRole("button", { name: /^Load (more|older)$/ })).toHaveCount(0)
  await expect(rows.last().locator(".ros-who")).toHaveText("Started the week")
  // No line twice.
  const texts = await rows.evaluateAll((els) => els.map((e) => e.textContent))
  expect(texts.length).toBe(26)
})

test("last owner: Deactivate on a page that still showed two owners is refused by the API (409 last_owner) and the screen says why and keeps the owner", async ({ as }) => {
  const page = await as("admin")
  await page.goto("/settings/users")
  const off = page.getByRole("button", { name: "Deactivate Amara Bello" })
  await expect(off).toBeEnabled() // two active owners on this page
  // Meanwhile the other owner leaves (another session): Amara Bello is now the last owner.
  const owner = await apiAs("owner")
  const people: { userId: string; name: string }[] = await owner.get("/v1/people?limit=100")
  await owner.send("POST", `/v1/members/${people.find((p) => p.name === SECOND_OWNER)!.userId}/deactivate`)
  await owner.ctx.dispose()
  await off.click()
  const answer = page.waitForResponse((r) => /\/deactivate$/.test(r.url()) && r.request().method() === "POST")
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click()
  const res = await answer
  expect(res.status()).toBe(409)
  expect((await res.json()).code).toBe("last_owner")
  await expect(page.getByText("The last owner can't be removed.")).toBeVisible()
  const row = page.locator("tr", { hasText: "Amara Bello" })
  await expect(row.getByText("Active", { exact: true })).toBeVisible()
})

async function weekIdOf(locationId: string, monday: string): Promise<string> {
  const ops = await apiAs("ops")
  try {
    return (await ops.get(`/v1/roster/weeks?locationId=${locationId}&from=${monday}`)).weeks.find((w: { weekStart: string }) => w.weekStart === monday).id
  } finally {
    await ops.ctx.dispose()
  }
}

// A WebM file's first bytes (EBML header) and some padding: enough for the audio type and the scanner (ClamAV in the e2e stack) to pass it. It does not need to decode: the test
// checks that the player asks the API for the recording through a fresh play path, not that a browser can decode it.
const WEBM = Buffer.concat([Buffer.from("1a45dfa3a34286810142f7810142f2810442f381084282847765626d42878102428581021853806701", "hex"), Buffer.alloc(256, 0)])

test("Today voice: a task whose voice note is scanned clean (ClamAV) gets the voice lead in Play my day, and the player asks the API for it through a fresh play path", async ({ as }) => {
  // Set-up through the API: a task for Tomasz due today, with a voice note the owner (a manager) records; the scanner marks it clean.
  const owner = await apiAs("owner")
  const people: { userId: string; name: string }[] = await owner.get("/v1/people?limit=100")
  const teams: { id: string; name: string }[] = await owner.get("/v1/teams")
  const { dublinToday } = await import("./fixtures")
  const today = dublinToday()
  const task = await owner.send("POST", "/v1/tasks", { title: "E2E voice briefing", start: `${today}T00:05:00`, due: `${today}T23:50:00`, primary: people.find((p) => p.name === ROSTER.staff.tomasz)!.userId, teamId: teams.find((t) => t.name === "Cleaning")!.id, priority: 1 })
  const intent = await owner.send("POST", `/v1/tasks/${task.id}/uploads`, { purpose: "voice", name: "briefing.webm", mime: "audio/webm", sizeBytes: WEBM.length })
  const put = await fetch(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: WEBM })
  expect(put.ok, `upload to the bucket: ${put.status}`).toBe(true)
  await owner.send("POST", `/v1/tasks/${task.id}/uploads/${intent.fileId}/complete`)
  // The scan runs in the worker: the voice note can be set once the file is clean (until then the API refuses it).
  await expect.poll(async () => {
    const t = await owner.get(`/v1/tasks/${task.id}`)
    const r = await owner.ctx.put(`/v1/tasks/${task.id}/voice-note`, { data: { version: t.version, fileId: intent.fileId, durationSec: 3 } })
    return r.status()
  }, { timeout: 90_000, intervals: [1_000] }).toBe(200)
  await owner.ctx.dispose()

  const page = await as("member")
  // The browser's speech engine is replaced by one that finishes each line at once (headless Chromium has no voices): the player moves on exactly as after real speech.
  await page.addInitScript(() => {
    const spoken: string[] = []
    ;(window as unknown as { __spoken: string[] }).__spoken = spoken
    const fake = { speaking: false, pending: false, paused: false, speak: (u: SpeechSynthesisUtterance) => { spoken.push(u.text); setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 30) }, cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {}, removeEventListener() {} }
    Object.defineProperty(window, "speechSynthesis", { configurable: true, get: () => fake })
  })
  await page.goto("/")
  const bar = page.getByRole("button", { name: /^(Open|Close) your day/ })
  await expect(bar).toBeVisible()
  if ((await bar.getAttribute("aria-label"))?.startsWith("Open")) await bar.click()
  const played = page.waitForRequest((r) => new RegExp(`/v1/tasks/${task.id}/voice-note\\?play=`).test(r.url()))
  await page.getByRole("button", { name: "Play my day" }).click()
  const req = await played
  const res = await req.response()
  expect(res && res.status() < 400, `play path answered ${res?.status()}`).toBe(true)
  // The task's line ends with the voice lead (the API said hasVoice); a task without a voice note never gets it.
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)
  const lines = spoken.filter((t) => t.includes("Voice instructions:"))
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.every((t) => t.includes("E2E voice briefing"))).toBe(true)
  // A second play asks again with a NEW play path (never a kept URL).
  const again = page.waitForRequest((r) => new RegExp(`/v1/tasks/${task.id}/voice-note\\?play=`).test(r.url()) && r.url() !== req.url())
  const play = page.getByRole("group", { name: "Play my day" }).getByRole("button", { name: "Play", exact: true })
  await expect(play).toBeVisible() // the run reached the end (each line ends at once, the recording does not decode): Play starts it again from the top
  await play.click()
  expect((await again).url()).not.toBe(req.url())
})
