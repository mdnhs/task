import { apiAs, expect, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"
import { PATTERN, TASKS } from "./world"

// CR-03 / AC-M1-03: a submitted report reaches the manager's inbox within a minute, complete; the manager accepts it with a comment; a past-deadline member shows Missing.
// Independent of CR-01: reporting is switched on for the member through the API here (CR-01 does it through the UI).
test.beforeAll(async () => {
  const ops = await apiAs("ops")
  const people: { userId: string; name: string }[] = await ops.get("/v1/people?limit=100")
  for (const n of ["M. Haddad", "J. Silva"]) await ops.send("PUT", `/v1/shifts/reporting/people/${people.find((p) => p.name === n)!.userId}`, { on: true })
  await ops.ctx.dispose()
})

test("CR-03 a submitted report is in the manager's inbox within a minute and is accepted", async ({ as, page }) => {
  // The one UI sign-in of this spec: the member through the form.
  await signInThroughUi(page, PERSONAS.haddad, DEMO_PASSWORD)
  await page.goto("/daily-reports")
  await page.getByRole("link", { name: "Open my report" }).click()
  await expect(page.getByText(TASKS.haddad)).toBeVisible()
  await page.getByRole("combobox", { name: `Status of ${TASKS.haddad}` }).click()
  await page.getByRole("option", { name: "Done", exact: true }).click()
  await page.getByLabel(`Time spent on ${TASKS.haddad}, minutes`).fill("20")
  await page.getByLabel(/^Summary/).fill("Gate check complete, no incidents.")
  await page.getByLabel(/^Notes for the next shift/).fill("Nothing to hand over.")
  await page.getByRole("button", { name: "Submit" }).click()
  await expect(page.getByText(/Report submitted/)).toBeVisible()
  const submittedAt = Date.now()

  // The manager's inbox shows the complete report within one minute (the inbox is re-read on each visit; no caching hides it).
  const ops = await as("ops")
  const row = ops.getByRole("row").filter({ hasText: "M. Haddad" }).filter({ hasText: PATTERN })
  await expect(async () => {
    await ops.goto("/daily-reports")
    await expect(row.getByText("Submitted", { exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] })
  expect(Date.now() - submittedAt).toBeLessThan(60_000)
  await expect(row).toContainText("1/1 done")

  // Complete: the summary, the task row with its minutes and the handover are all there.
  await row.getByRole("link").first().click()
  await expect(ops.getByText("Gate check complete, no incidents.")).toBeVisible()
  await expect(ops.getByText("Nothing to hand over.")).toBeVisible()
  await expect(ops.getByText(TASKS.haddad)).toBeVisible()
  await expect(ops.getByText("Submitted", { exact: true }).first()).toBeVisible()

  // The manager accepts it. (The UI takes a comment only when a report is returned; see the Silva step below.)
  await ops.getByRole("button", { name: "Accept", exact: true }).click()
  await expect(ops.getByText("Accepted", { exact: true }).first()).toBeVisible()

  // A seeded past-deadline member is flagged Missing in the inbox (yesterday's shifts of the demo tenant ended with no report).
  await ops.goto("/daily-reports")
  await ops.getByRole("group").getByRole("button", { name: /^Missing( \d+)?$/ }).click() // the chip carries the API's count since B8 Task 24
  const missing = ops.getByRole("row").filter({ hasText: "Missing" })
  await expect(missing.first()).toBeVisible()
  await expect(missing.filter({ hasText: "Daniel Okafor" }).first()).toBeVisible()

  // A manager can send a report back with a comment; the member reads it and can resubmit.
  const silva = await as("silva")
  await silva.goto("/daily-reports")
  await silva.getByRole("link", { name: "Open my report" }).click()
  await silva.getByLabel(/^Summary/).fill("Quiet shift.")
  await silva.getByLabel(/^Notes for the next shift/).fill("None.")
  await silva.getByRole("button", { name: "Submit" }).click()
  await expect(silva.getByText(/Report submitted/)).toBeVisible()
  await expect(async () => {
    await ops.goto("/daily-reports")
    await ops.getByRole("row").filter({ hasText: "J. Silva" }).filter({ hasText: PATTERN }).getByRole("link").first().click()
    await expect(ops.getByRole("button", { name: "Return with comment" })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await ops.getByRole("button", { name: "Return with comment" }).click()
  await ops.getByRole("textbox", { name: "Comment" }).fill("Please list the gate you checked.")
  await ops.getByRole("button", { name: "Return report" }).click()
  await expect(ops.getByText("Returned", { exact: true }).first()).toBeVisible()
  await silva.goto("/daily-reports")
  await silva.getByRole("link", { name: /Open my report|Fix and resubmit/ }).first().click()
  await expect(silva.getByText("Please list the gate you checked.")).toBeVisible()
})
