import { apiAs, dublinToday, expect, pickDate, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"

// CR-04 / AC-M1-04: a manager adds, reassigns, reschedules and removes a member's task; the member gets a notification for each change and the history lists them.
test("CR-04 a manager adds, reassigns, reschedules and removes a task; the bell and the history show each change", async ({ as, page }) => {
  const title = `E2E manager task ${Date.now() % 100000}`
  const due = dublinToday(3) // three days out
  await signInThroughUi(page, PERSONAS.ops, DEMO_PASSWORD)

  // --- add ---
  await page.goto("/tasks/new")
  await expect(page.locator("#nt-title")).toHaveCount(1) // the loading skeleton (the real form, masked) has gone
  await page.locator("#nt-title").fill(title)
  await page.locator("#nt-desc").fill("Check the east stairwell lights.")
  await pickDate(page, "#nt-due", due)
  await page.locator("#nt-time").click()
  await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: "10", exact: true }).click()
  await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: "00", exact: true }).click()
  await page.getByRole("listbox", { name: "AM or PM" }).getByRole("option", { name: "AM", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.locator("#nt-dept").click()
  await page.getByRole("option", { name: "Cleaning", exact: true }).click()
  await page.locator("#nt-assignee").click()
  await page.getByRole("option", { name: "Tomasz Wójcik", exact: true }).click()
  await page.getByRole("button", { name: "Create task" }).click()
  await expect(page).toHaveURL(/\/tasks\/TSK-\d+$|\/tasks$/)
  const ops = await apiAs("ops")
  const task = (await ops.get(`/v1/tasks?q=${encodeURIComponent(title)}`)).items[0] as { id: string; ref: string; version: number }
  // A follow-on task that depends on this one, so the reschedule has a knock-on to preview.
  const followTitle = `${title} follow-on`
  const people: { userId: string; name: string }[] = await ops.get("/v1/people?limit=100")
  const follow = await ops.send("POST", "/v1/tasks", { title: followTitle, description: "after", start: `${dublinToday(4)}T08:00:00`, due: `${dublinToday(4)}T12:00:00`, primary: people.find((p) => p.name === "Tomasz Wójcik")!.userId })
  await ops.send("PUT", `/v1/tasks/${follow.id}/dependencies`, { version: follow.version, dependsOnIds: [task.id] })

  // --- reschedule with the knock-on preview ---
  await page.goto(`/tasks/${task.ref}`)
  await page.getByRole("button", { name: "Reschedule", exact: true }).click()
  const rs = page.getByRole("dialog", { name: "Reschedule" })
  await pickDate(page, "#rs-due", dublinToday(5), rs)
  await expect(rs.getByText("These dependent tasks move too")).toBeVisible()
  await expect(rs.getByText(followTitle)).toBeVisible()
  await rs.getByRole("button", { name: "Save dates" }).click()
  await expect(rs).toBeHidden()

  // --- reassign to Amara Kone ---
  await page.getByRole("button", { name: "Reassign", exact: true }).click()
  const ra = page.getByRole("dialog", { name: "Reassign" })
  await ra.locator("#ra-assignee").click()
  await page.getByRole("option", { name: "Amara Kone", exact: true }).click()
  await ra.getByRole("button", { name: "Save", exact: true }).click()
  await expect(ra).toBeHidden()

  // --- the history lists every change ---
  const tl = page.getByRole("region", { name: "Timeline" })
  const lines = tl.locator(".td-tl-text")
  await expect(lines.filter({ hasText: "Task created" })).toHaveCount(1)
  await expect(lines.filter({ hasText: "Rescheduled" })).toHaveCount(1)
  await expect(lines.filter({ hasText: "Reassigned" })).toHaveCount(1) // (the line a moment ago animating out is gone by now)
  await expect(tl.getByText("Assignees Tomasz Wójcik → Amara Kone")).toBeVisible()
  await expect(tl.locator(".td-tl-meta").filter({ hasText: "Lilianna Novak" }).first()).toBeVisible()

  // --- remove (archive) ---
  await page.getByRole("button", { name: "Remove", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove task" }).click()
  await expect(page.getByText(/archived\. Restore it from Tasks/)).toBeVisible()

  // --- the bell: every change reached the member ---
  const bell = async (who: Awaited<ReturnType<typeof as>>) => {
    await who.goto("/")
    await who.getByRole("button", { name: /^Notifications/ }).click()
    return who.getByRole("dialog").last()
  }
  const tom = await bell(await as("member"))
  await expect(tom.getByText("New task").first()).toBeVisible()
  await expect(tom.getByText("Task rescheduled").first()).toBeVisible()
  await expect(tom.getByText("Task assignment changed")).toBeVisible()
  // The new assignee hears about the removal.
  const kone = await bell(await as("kone"))
  await expect(kone.getByText("Task removed")).toBeVisible()

  // The removal is in the history too. A removed task leaves the lists and its history is read through the archive: it shows in Tasks -> Archive, and once restored
  // (the manager's undo) its history lists the archive line with the person who was told.
  await page.goto("/tasks/archive")
  await expect(page.getByRole("row").filter({ hasText: task.ref })).toContainText("30 days left")
  const restored = await ops.send("POST", `/v1/tasks/${task.id}/restore`, {})
  expect(restored.ref).toBe(task.ref)
  const hist = (await ops.get(`/v1/tasks/${task.id}/history`)).items as { kind: string; notified: string[]; hiddenNotified: number }[]
  expect(hist.map((h) => h.kind)).toEqual(expect.arrayContaining(["created", "rescheduled", "assigned", "archived", "restored"]))
  const koneId = people.find((p) => p.name === "Amara Kone")!.userId
  expect(hist.find((h) => h.kind === "archived")!.notified).toEqual([koneId]) // the new assignee was told; the manager who did it was not
})
