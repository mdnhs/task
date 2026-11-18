import { apiAs, expect, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"
import { dublinToday } from "./fixtures"

// A 1x1 PNG (a real, valid image: the scanner and the mime sniffing both see a photo).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

// CR-05 / AC-M1-05: a proof-required task cannot be closed without proof; the member attaches a photo (real MinIO and ClamAV), it reads Scanning then clean; Complete
// moves the task to review; a different manager verifies it and sees when it was taken; the assignee and a co-assignee manager get no Verify.
test("CR-05 proof is required, uploaded, scanned and verified by a different manager", async ({ as, page }) => {
  const title = `E2E proof task ${Date.now() % 100000}`
  const owner = await apiAs("owner")
  const people: { userId: string; name: string }[] = await owner.get("/v1/people?limit=100")
  const id = (n: string) => people.find((p) => p.name === n)!.userId
  const teams: { id: string; name: string }[] = await owner.get("/v1/teams")
  const created = await owner.send("POST", "/v1/tasks", {
    title, description: "Photo of the cleaned floor.", start: `${dublinToday()}T08:00:00`, due: `${dublinToday(2)}T10:00:00`, primary: id("Tomasz Wójcik"), others: [id("Lilianna Novak")],
    teamId: teams.find((t) => t.name === "Cleaning")!.id, evidenceRule: { mode: "required", types: ["photo"], min: 1, instruction: "Photo of the cleaned floor", review: "manager" },
  })
  // The API refuses the close as well, whatever the screen does (422 evidence_required), and the task is untouched.
  const memberApi = await apiAs("member")
  const refused = await memberApi.ctx.post(`/v1/tasks/${created.id}/complete`, { data: { version: created.version } })
  expect(refused.status()).toBe(422)
  expect((await refused.json()).code).toBe("evidence_required")
  // The member signs in through the form (the one UI sign-in of this spec).
  await signInThroughUi(page, PERSONAS.member, DEMO_PASSWORD)
  await page.goto(`/tasks/${created.ref}`)
  await expect(page.getByText("0 of 1 attached · 1 more needed")).toBeVisible()
  await page.getByRole("button", { name: "Complete", exact: true }).click()
  // Refused without proof: the evidence step opens and its confirm button says what is missing; nothing was completed.
  const step = page.getByRole("dialog", { name: "Add evidence to complete" })
  await expect(step).toBeVisible()
  await expect(step.getByRole("button", { name: "1 more needed" })).toBeDisabled()
  // The photo goes to MinIO, then ClamAV scans it: the row reads Scanning, then it counts.
  // Hold the scan result back for a moment so the Scanning state is observable (the real scanner is fast).
  await page.route("**/v1/tasks/*/uploads/*/complete", async (route) => { await new Promise((r) => setTimeout(r, 2_500)); await route.continue() })
  await step.locator('input[capture]').setInputFiles({ name: "floor.png", mimeType: "image/png", buffer: PNG })
  await expect(step.getByText("Scanning", { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(step.getByText("1 of 1 attached")).toBeVisible({ timeout: 60_000 })
  const done = step.getByRole("button", { name: /^Complete/ })
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page.getByRole("link", { name: "← All tasks" })).toBeVisible()
  await expect(page.getByLabel("Actions").getByText("Awaiting verification")).toBeVisible()
  // The assignee cannot verify their own proof.
  await expect(page.getByRole("button", { name: "Verify" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0)

  // A co-assignee who is a manager (ops) gets no Verify either; the owner (not an assignee) does, and sees when the photo was taken.
  const ops = await as("ops")
  await ops.goto(`/tasks/${created.ref}`)
  await expect(ops.getByText("Taken with the camera")).toBeVisible()
  await expect(ops.getByRole("button", { name: "Verify" })).toHaveCount(0)
  const mgr = await as("owner")
  await mgr.goto(`/tasks/${created.ref}`)
  const item = mgr.locator(".ev-item").filter({ hasText: "floor.png" })
  await expect(item.getByText("Taken with the camera")).toBeVisible()
  await expect(item.locator(".td-tl-meta")).toContainText(/Today \d{1,2}:\d{2} (AM|PM) Ireland Time/) // the capture time
  await item.getByRole("button", { name: "Verify", exact: true }).click()
  await expect(mgr.getByText("Evidence verified", { exact: true })).toBeVisible()
  await expect(item.getByText("Verified", { exact: true })).toBeVisible()
  await mgr.reload()
  await expect(mgr.locator(".ev-item").filter({ hasText: "floor.png" }).getByText("Verified", { exact: true })).toBeVisible()
})
