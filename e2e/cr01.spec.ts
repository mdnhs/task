import { apiAs, expect, search, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"
import { PATTERN, REPORTING_ON, TASKS } from "./world"

// CR-01 / AC-M1-01, AC-M1-02: the manager picks who reports, only they get a report today, a member fills in exactly their shift tasks and submits.
test("CR-01 reporting is switched on per member and the member reports on their shift tasks", async ({ as, page }) => {
  // The one UI sign-in of this spec: the all-scope manager through the form.
  await signInThroughUi(page, PERSONAS.ops, DEMO_PASSWORD)
  await page.goto("/shifts")
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "People" }).click()
  for (const name of REPORTING_ON) {
    await search(page, "Search people", name)
    const sw = page.getByRole("switch", { name: `End-of-shift reporting for ${name}` })
    await expect(sw).not.toBeChecked()
    await sw.click()
    await expect(sw).toBeChecked()
  }
  // Only those three have a report today: the inbox lists three rows for the pattern, one per switched-on member.
  await page.goto("/daily-reports")
  const rows = page.getByRole("row").filter({ hasText: PATTERN })
  await expect(rows).toHaveCount(3)
  for (const name of REPORTING_ON) await expect(rows.filter({ hasText: name })).toHaveCount(1)
  for (const name of ["Ismail Rahman", "Leo Fernandez"]) await expect(rows.filter({ hasText: name })).toHaveCount(0)

  // A member opens their report: exactly their shift tasks (not another member's, not tomorrow's).
  const kowalski = await as("kowalski")
  await kowalski.goto("/daily-reports")
  await kowalski.getByRole("link", { name: "Open my report" }).click()
  await expect(kowalski).toHaveURL(/\/daily-reports\/[0-9a-f-]{36}$/)
  const items = kowalski.getByRole("row").filter({ has: kowalski.getByLabel(/^Status of /) })
  await expect(items).toHaveCount(2)
  await expect(items.filter({ hasText: TASKS.kowalskiA })).toHaveCount(1)
  await expect(items.filter({ hasText: TASKS.kowalskiB })).toHaveCount(1)
  await expect(kowalski.getByText(TASKS.haddad)).toHaveCount(0)
  await expect(kowalski.getByText(TASKS.kowalskiLater)).toHaveCount(0)

  // Statuses and minutes, then the template's required notes, then submit.
  const setStatus = async (title: string, label: string) => {
    await kowalski.getByRole("combobox", { name: `Status of ${title}` }).click()
    await kowalski.getByRole("option", { name: label, exact: true }).click()
    await expect(kowalski.getByRole("listbox")).toHaveCount(0) // the closing popup must be gone before the next one opens
  }
  await setStatus(TASKS.kowalskiA, "Done")
  await kowalski.getByLabel(`Time spent on ${TASKS.kowalskiA}, minutes`).fill("30")
  await setStatus(TASKS.kowalskiB, "In progress")
  await kowalski.getByLabel(`Time spent on ${TASKS.kowalskiB}, minutes`).fill("45")
  await kowalski.getByLabel(/^Summary/).fill("Patrols done, gate A checked.")
  await kowalski.getByLabel(/^Notes for the next shift/).fill("Gate B lock is stiff.")
  await kowalski.getByRole("button", { name: "Submit" }).click()
  await expect(kowalski.getByText(/Report submitted/)).toBeVisible()
  await expect(kowalski).toHaveURL(/\/daily-reports$/)

  // The manager sees the tasks updated: status, minutes, and the neutral history line (no judgement, no names of the report's author in the text).
  const refs: { ref: string; title: string }[] = (await (await apiAs("ops")).get("/v1/tasks?limit=100")).items
  const refOf = (title: string) => refs.find((t) => t.title === title)!.ref
  await page.goto(`/tasks/${refOf(TASKS.kowalskiA)}`)
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Status set to Completed, 30 min logged from the shift report E2E all day/)).toBeVisible()
  await page.goto(`/tasks/${refOf(TASKS.kowalskiB)}`)
  await expect(page.getByText("In Progress", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/45 min logged from the shift report E2E all day/)).toBeVisible()
  await expect(page.getByText(/Notified [A-Za-z0-9]{32}/)).toHaveCount(0) // a raw user id in the timeline was a defect (T6.9 walk)
})
