import { dublinToday, expect, spokenText, test } from "./fixtures"
import { ROSTER, rosterIds, rosterWeeks } from "./world"

// CR-07 / AC-RS-01 (FR-RS-10/12): the owner picks a location and a week and sees seven days, each with who is working and their own times, and the day's staff count against
// the target; a short day and an over day are highlighted with the number. The week is the world's (e2e/world.ts: Quayside Depot, eight weeks out, published by the office).
test("CR-07 (AC-RS-01): owner picks a location and week, sees seven days, who is working with times, and the staff count against the target; short days are highlighted", async ({ as }) => {
  const { quayside } = await rosterIds()
  const W = rosterWeeks()
  const page = await as("owner")
  await page.goto("/rosters")
  // Pick the location in the switcher, then go to the week (the URL carries both: ?location=&week=).
  await page.getByRole("combobox", { name: "Location" }).click()
  await page.getByRole("option", { name: ROSTER.quayside }).click()
  await expect(page).toHaveURL(new RegExp(`location=${quayside}`))
  await page.goto(`/rosters?location=${quayside}&week=${W.cr07}`)
  const block = page.getByRole("region", { name: ROSTER.quayside })
  await expect(block.getByText("Published", { exact: true })).toBeVisible()
  const days = block.locator(".ros-day")
  await expect(days).toHaveCount(7)
  const day = (i: number) => days.nth(i)
  // Monday: two people, each with their own start and end, 2 of 2.
  await expect(day(0).locator(".ros-shift")).toHaveCount(2)
  await expect(day(0).locator(".ros-shift", { hasText: ROSTER.staff.tomasz })).toContainText("08:00–16:00")
  await expect(day(0).locator(".ros-shift", { hasText: ROSTER.staff.kone })).toContainText("09:30–17:30")
  await expect.poll(() => spokenText(day(0).locator(".ros-count"))).toBe("2/2")
  await expect(day(0)).not.toHaveAttribute("data-short", /.*/)
  // Tuesday is short by one (highlighted, with the number), Wednesday one over.
  await expect(day(1).locator(".ros-shift")).toHaveCount(1)
  await expect(day(1)).toHaveAttribute("data-short", "true")
  await expect.poll(() => spokenText(day(1).locator(".ros-count"))).toBe("1/2 −1 short")
  await expect(day(2)).toHaveAttribute("data-surplus", "true")
  await expect.poll(() => spokenText(day(2).locator(".ros-count"))).toBe("3/2 +1 over")
  for (const i of [3, 4]) await expect.poll(() => spokenText(day(i).locator(".ros-count"))).toBe("2/2")
  // The weekend has no target: a count only.
  await expect(day(5).locator(".ros-none")).toHaveText("No shifts")
  // The week's total against its target, with the shortfall.
  await expect(block.locator(".ros-block-head .ros-sum")).toHaveText("10/10 · 1 short")
})

// DST day (FR-RS-21, Review Focus 3): the night of Sat 24 Oct 2026 22:00 to Sun 06:00 crosses the clock change (Europe/Dublin, 02:00 back to 01:00) and is 9 real hours.
// The week is pinned to a fixed date (no clock needed: the API has no test clock, and a past week can be read and built by the office). The board shows no lengths (FR-RS-10: who,
// times, role, count): it shows the night on the day it starts, 22:00–06:00 "+1", counted on Saturday; the 9 hours are the API's instants that the board is drawn from, and My
// roster prints them ("9h") while the night is inside its four-weeks-back window.
test("DST day: the 25 Oct 2026 night shift reads 9 hours on the board (world clock fixed by the API test clock, as in B6 walk)", async ({ as }) => {
  const { quayside } = await rosterIds()
  const page = await as("owner")
  await page.goto(`/rosters?location=${quayside}&week=${ROSTER.dstWeek}`)
  const days = page.getByRole("region", { name: ROSTER.quayside }).locator(".ros-day")
  await expect(days).toHaveCount(7)
  const sat = days.nth(5)
  await expect(sat).toHaveAttribute("aria-label", "Sat 24 Oct")
  const card = sat.locator(".ros-shift", { hasText: ROSTER.staff.tomasz })
  await expect(card.locator(".ros-time")).toHaveText("22:00–06:00 +1, ends the next day")
  await expect.poll(() => spokenText(sat.locator(".ros-count"))).toMatch(/^1( |$)/) // counted on Saturday, the day it starts
  await expect(days.nth(6).locator(".ros-shift")).toHaveCount(0)
  // The instants behind the card: 9 hours apart, the end on Sunday at 06:00 GMT (the start is 21:00 UTC, still summer time).
  const payload = await (await page.request.get(`/v1/roster/weeks?locationId=${quayside}&from=${ROSTER.dstWeek}`)).json()
  const night = payload.shifts.find((s: { date: string }) => s.date === ROSTER.dstNight)
  expect([night.start, night.end, night.startAt, night.endAt]).toEqual(["22:00", "06:00", "2026-10-24T21:00:00.000Z", "2026-10-25T06:00:00.000Z"])
  expect((Date.parse(night.endAt) - Date.parse(night.startAt)) / 3_600_000).toBe(9)
  // My roster shows the length while the night is inside its window (today - 28 days): until 21 Nov 2026.
  if (dublinToday(-28) <= ROSTER.dstNight) {
    const me = await as("member")
    await me.goto("/rosters/mine")
    await me.getByRole("group", { name: "My roster sections" }).getByRole("button", { name: /^Shifts/ }).click()
    await me.locator("summary", { hasText: /^Earlier shifts/ }).click()
    const row = me.locator(".mr-shift").filter({ has: me.locator(".mr-when b", { hasText: /^Sat 24 Oct$/ }) })
    await expect(row.locator(".mr-when .num")).toHaveText("10:00 PM to 6:00 AM +1 · 9h")
  }
})
