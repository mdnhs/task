import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { ROSTER, rosterIds, rosterWeeks } from "./world"

const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`
}

/** Picks a time in the TimePicker of the field labelled `label` (hour 1..12, minute, AM or PM). */
async function pickTime(page: Page, label: string, hour: number, minute: string, half: "AM" | "PM") {
  await page.getByRole("combobox", { name: label }).click()
  const pop = page.locator(".od-time")
  await pop.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: String(hour), exact: true }).click()
  await pop.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: minute, exact: true }).click()
  await pop.getByRole("listbox", { name: "AM or PM" }).getByRole("option", { name: half, exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(pop).toHaveCount(0)
}

/** My roster's row for a date (Shifts tab): "<day>" then "<start> to <end> · <length>". */
async function myRow(page: Page, date: string) {
  await page.goto("/rosters/mine")
  await page.getByRole("group", { name: "My roster sections" }).getByRole("button", { name: /^Shifts/ }).click()
  return page.locator(".mr-shift").filter({ has: page.locator(".mr-when b", { hasText: new RegExp(`^${fmt(date)}$`) }) })
}

// CR-08 / AC-RS-02 (FR-RS-20): two people on ONE shift with different start times. The supervisor of the site sets Amara Kone's own start and end in the edit form (the
// week is a draft the world made with both people on Monday's Early shift at the type's 08:00-16:00), publishes, and each person's My roster shows their own times.
test("CR-08 (AC-RS-02): two people on one shift with different start times; both show on the board and in the staff member's My roster", async ({ as }) => {
  const { quayside } = await rosterIds()
  const W = rosterWeeks()
  const monday = W.cr08
  const page = await as(ROSTER.supervisor)
  await page.goto(`/rosters?location=${quayside}&week=${monday}`)
  const day = page.getByRole("region", { name: ROSTER.quayside }).locator(".ros-day").first()
  await expect(day.locator(".ros-shift")).toHaveCount(2)
  await day.getByRole("button", { name: `Edit shift, ${ROSTER.staff.kone}, 08:00 to 16:00` }).click()
  const dialog = page.getByRole("dialog", { name: "Edit shift" })
  await expect(dialog).toBeVisible()
  await pickTime(page, "Start", 9, "30", "AM")
  await pickTime(page, "End", 5, "30", "PM")
  await dialog.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Shift saved")).toBeVisible()
  // Both on the same day, each with their own times, also after a fresh read from the API.
  await page.reload()
  await expect(day.locator(".ros-shift", { hasText: ROSTER.staff.tomasz })).toContainText("08:00–16:00")
  await expect(day.locator(".ros-shift", { hasText: ROSTER.staff.kone })).toContainText("09:30–17:30")
  // Publish (no rule breaks), so the staff see it.
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const pub = page.getByRole("dialog", { name: /^Publish / })
  await expect(pub.getByText("No rule breaks. Staff will see and confirm their shifts.")).toBeVisible()
  await pub.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Week published")).toBeVisible()

  // In the app: each person's own times (and the real length of the shift).
  const tomasz = await as("member")
  await expect((await myRow(tomasz, monday)).locator(".mr-when .num")).toHaveText("8:00 AM to 4:00 PM · 8h")
  const kone = await as("kone")
  await expect((await myRow(kone, monday)).locator(".mr-when .num")).toHaveText("9:30 AM to 5:30 PM · 8h")
})

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// AC-RS-04 (FR-RS rule checks, D9): Tomasz works Monday night (22:00 to Tuesday 06:00), then Tuesday 14:00-22:00: 8 hours of rest. Publishing shows the warning, naming him and both
// shifts; a warning never stops the publish.
test("AC-RS-04: publishing a week with an under-11-hour rest shows a warning naming the person and both shifts", async ({ as }) => {
  const { quayside } = await rosterIds()
  const monday = rosterWeeks().rest
  const page = await as(ROSTER.supervisor)
  await page.goto(`/rosters?location=${quayside}&week=${monday}`)
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const pub = page.getByRole("dialog", { name: /^Publish / })
  await expect(pub.getByText("Warnings only. You can publish.")).toBeVisible()
  const row = pub.getByRole("list", { name: "Rule breaks" }).getByRole("listitem").first()
  await expect(row.locator("b").first()).toHaveText(ROSTER.staff.tomasz)
  await expect(row).toContainText("has only 8h00 rest between")
  await expect(row).toContainText(`${monday} 22:00-06:00`)
  await expect(row).toContainText(`${addDays(monday, 1)} 14:00-22:00`)
  await expect(row).toHaveAttribute("data-kind", "warn")
  await pub.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("Week published")).toBeVisible()
  await expect(page.getByRole("region", { name: ROSTER.quayside }).getByText("Published", { exact: true })).toBeVisible()
})

// AC-RS-06 (FR-RS-26/27): Repeat on a published week creates next week's draft with the same people and times; Amara Kone has approved leave on next week's Wednesday, so her copy
// is an OPEN shift and is listed in the conflict list (never silently dropped, never rostered).
test("AC-RS-06: Repeat roster on the published week creates next week's draft, the person on approved leave is an open shift in the conflict list", async ({ as }) => {
  const { quayside } = await rosterIds()
  const W = rosterWeeks()
  const page = await as("ops")
  await page.goto(`/rosters?location=${quayside}&week=${W.repeat}`)
  const block = page.getByRole("region", { name: ROSTER.quayside })
  await expect(block.getByText("Published", { exact: true })).toBeVisible()
  await block.getByRole("button", { name: "Repeat", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: /^Repeat / })
  await expect(dialog.getByRole("spinbutton", { name: "Repeat into the next" })).toHaveValue("1")
  await dialog.getByRole("button", { name: "Repeat", exact: true }).click()
  await expect(dialog.getByLabel("1 kept, 0 with a warning, 1 open")).toBeVisible()
  const line = dialog.getByRole("list", { name: "Repeat conflicts" }).getByRole("listitem")
  await expect(line).toHaveCount(1)
  await expect(line.locator("b")).toHaveText(ROSTER.staff.kone)
  await expect(line).toContainText("approved leave")
  await expect(line).toContainText("(now open)")
  await dialog.getByRole("button", { name: "Done" }).click()
  // The conflict list stays on the page (next week is not in view, so the line gives its date).
  const panel = page.getByRole("region", { name: "Repeat conflicts" }).locator(".ros-viol-row")
  await expect(panel).toHaveCount(1)
  await expect(panel.locator("b")).toHaveText(ROSTER.staff.kone)
  await expect(panel).toContainText(`${fmt(addDays(W.repeatNext, 2))}, open shift`)

  // Next week: a draft, Tomasz on Monday at his time, Wednesday an open shift (not Amara Kone).
  await page.goto(`/rosters?location=${quayside}&week=${W.repeatNext}`)
  await expect(block.getByText("Draft", { exact: true })).toBeVisible()
  const days = block.locator(".ros-day")
  await expect(days.nth(0).locator(".ros-shift", { hasText: ROSTER.staff.tomasz })).toContainText("08:00–16:00")
  await expect(days.nth(2).locator(".ros-shift")).toHaveCount(1)
  await expect(days.nth(2).locator(".ros-shift")).toHaveAttribute("data-open", "true")
  await expect(days.nth(2)).not.toContainText(ROSTER.staff.kone)
})
