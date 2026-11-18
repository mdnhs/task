import { apiAs, dublinToday, expect, pickDate, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"

// CR-06 / AC-M1-06, AC-M1-07 (this suite is the Android emulation; the native app is out of scope): with a bound Android device Drive is blocked and says so, and every other
// Module 1 feature works on the phone viewport: creating a task, moving it, ticking a checklist, submitting the end-of-shift report.
test("CR-06 on a bound Android phone Drive is blocked and the rest works", async ({ page, isMobile }) => {
  expect(isMobile).toBe(true)
  const stamp = Date.now() % 100000
  const ops = await apiAs("ops")
  const people: { userId: string; name: string }[] = await ops.get("/v1/people?limit=100")
  const leo = people.find((p) => p.name === "Leo Fernandez")!.userId
  await ops.send("PUT", `/v1/shifts/reporting/people/${leo}`, { on: true })
  const admin = await apiAs("admin")
  const device = await admin.send("POST", "/v1/devices", { userId: leo, type: "android", owner: "personal", label: `E2E Leo phone ${stamp}`, trusted: true })
  const { code } = await admin.send("POST", `/v1/devices/${device.id}/enrolment-code`)
  const driveTask = await ops.send("POST", "/v1/tasks", { title: `E2E phone drive task ${stamp}`, description: "Attach the plan.", start: `${dublinToday()}T08:00:00`, due: `${dublinToday()}T18:00:00`, primary: leo, evidenceRule: { mode: "optional", types: ["note", "drive"], min: 0, instruction: "", review: "manager" } })

  // The phone signs in through the form and is bound as the member's Android device (the signed od-device cookie lives in this browser context).
  await signInThroughUi(page, PERSONAS.leo, DEMO_PASSWORD)
  const bound = await page.context().request.post(`/v1/devices/${device.id}/bind`, { data: { code }, headers: { origin: new URL(page.url()).origin } })
  expect(bound.status()).toBe(200)
  await page.goto("/account/security")
  await expect(page.getByRole("region", { name: "This device" })).toContainText(`E2E Leo phone ${stamp}`) // the browser is now that Android device

  // Drive is blocked: the button is off and says why, and an attempt to add a Drive item through the API is refused with the policy message.
  await page.goto(`/tasks/${driveTask.ref}`)
  const drive = page.getByRole("button", { name: /^Drive link/ })
  await expect(drive).toBeDisabled()
  await expect(drive).toHaveAttribute("title", "Available on your work PC")
  await expect(page.getByRole("link", { name: /drive\.google\.com/ })).toHaveCount(0)
  const refused = await page.context().request.post(`/v1/tasks/${driveTask.id}/evidence`, { data: { kind: "drive", text: "https://drive.google.com/file/d/abc123/view" }, headers: { origin: new URL(page.url()).origin } })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).code).toBe("device_policy") // shown to the member as "Available on your work PC." (lib/api/problem.ts)

  // Everything else works on the phone. Create a task for yourself...
  const title = `E2E phone task ${stamp}`
  await page.goto("/tasks/new")
  await expect(page.locator("#nt-title")).toHaveCount(1) // the loading skeleton has gone
  await page.locator("#nt-title").fill(title)
  await page.locator("#nt-desc").fill("Walk the east gate.")
  await pickDate(page, "#nt-due", dublinToday())
  await page.locator("#nt-time").click()
  await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: "9", exact: true }).click()
  await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: "00", exact: true }).click()
  await page.getByRole("listbox", { name: "AM or PM" }).getByRole("option", { name: "PM", exact: true }).click()
  await page.keyboard.press("Escape")
  await page.locator("#nt-dept").click()
  await page.getByRole("option", { name: "Security", exact: true }).click()
  await page.getByRole("button", { name: "Create task" }).click()
  await expect(page).not.toHaveURL(/\/tasks\/new/)
  const mine = (await ops.get(`/v1/tasks?q=${encodeURIComponent(title)}`)).items[0] as { id: string; ref: string }
  await ops.send("POST", `/v1/tasks/${mine.id}/checklist`, { text: "Lock the gate" })

  // ...move it, and tick its checklist.
  await page.goto(`/tasks/${mine.ref}`)
  await page.getByRole("button", { name: "Start work" }).click()
  await expect(page.getByText("In Progress", { exact: true }).first()).toBeVisible()
  await page.getByRole("checkbox", { name: /Lock the gate/ }).check()
  await expect(page.getByRole("checkbox", { name: /Lock the gate/ })).toBeChecked()
  await page.reload()
  await expect(page.getByRole("checkbox", { name: /Lock the gate/ })).toBeChecked()

  // The end-of-shift report is filled in and submitted from the phone.
  await page.goto("/daily-reports")
  await page.getByRole("link", { name: "Open my report" }).click()
  await page.getByLabel(/^Summary/).fill("East gate walked.")
  await page.getByLabel(/^Notes for the next shift/).fill("Nothing.")
  const minutes = page.getByLabel(/^Time spent on /)
  await expect(minutes.first()).toBeVisible()
  for (const box of await minutes.all()) await box.fill("15")
  await page.getByRole("button", { name: "Submit" }).click()
  await expect(page.getByText(/Report submitted/)).toBeVisible()
  await expect(page).toHaveURL(/\/daily-reports$/)
  // The manager has it (Leo reports to nobody: the all-scope manager sees every report).
  const mgr = await apiAs("ops")
  const rows = (await mgr.get("/v1/shift-reports?limit=50")).items as { person: string; status: string; shiftName: string }[]
  expect(rows.find((r) => r.person === "Leo Fernandez" && r.shiftName === "E2E all day")?.status).toBe("submitted")
})
