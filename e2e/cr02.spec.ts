import { apiAs, dublinToday, expect, signInThroughUi, test } from "./fixtures"
import { DEMO_PASSWORD, PERSONAS } from "./stack-env"

// CR-02 / AC-M0-03, AC-M1-06 (desktop): Google Drive works only on the member's registered company PC. An admin issues an enrolment code, the member enters it,
// the browser becomes that PC and Drive appears; the admin resets the binding and it goes again.
test("CR-02 Drive follows the enrolled company PC", async ({ as, page }) => {
  const title = `E2E drive task ${Date.now() % 100000}`
  const owner = await apiAs("owner")
  const people: { userId: string; name: string }[] = await owner.get("/v1/people?limit=100")
  const tomasz = people.find((p) => p.name === "Tomasz Wójcik")!.userId
  const task = await owner.send("POST", "/v1/tasks", { title, description: "Attach the site plan from Drive.", start: `${dublinToday()}T08:00:00`, due: `${dublinToday(2)}T10:00:00`, primary: tomasz, evidenceRule: { mode: "optional", types: ["note", "drive"], min: 0, instruction: "", review: "manager" } })

  // 1. A member on an unregistered browser: no Drive.
  await signInThroughUi(page, PERSONAS.member, DEMO_PASSWORD)
  await page.goto(`/tasks/${task.ref}`)
  const drive = page.getByRole("button", { name: /^Drive link/ })
  await expect(drive).toBeDisabled()
  await expect(drive).toHaveAttribute("title", "Available on your work PC")

  // 2. An admin registers the member's company PC and issues an enrolment code.
  const admin = await as("admin")
  await admin.goto("/settings/devices")
  await admin.getByRole("button", { name: "Add device" }).click()
  const add = admin.getByRole("dialog", { name: "Add device" })
  await add.locator("#dev-name").fill("E2E work PC")
  await add.locator("#dev-user").click()
  await admin.getByRole("option", { name: "Tomasz Wójcik" }).click()
  await add.getByRole("button", { name: "Add device", exact: true }).click()
  await admin.getByRole("button", { name: "Enrolment code for E2E work PC" }).click()
  const codeDialog = admin.getByRole("dialog", { name: "Enrolment code" })
  const code = (await codeDialog.locator("p.num").innerText()).trim()
  expect(code).toMatch(/^[A-Z0-9-]{6,}$/)
  await codeDialog.getByRole("button", { name: /close|done/i }).first().click().catch(() => admin.keyboard.press("Escape"))

  // 3. The member enters the code under Account -> Security; the browser becomes that company PC.
  await page.goto("/account/security")
  await expect(page.getByText(/Unregistered browser/)).toBeVisible()
  await page.getByRole("button", { name: "Enter code" }).click()
  const bind = page.getByRole("dialog", { name: "Set up this device" })
  await bind.getByRole("combobox", { name: "Device" }).click()
  await page.getByRole("option", { name: /E2E work PC/ }).click()
  await bind.locator("#dev-code").fill(code)
  await bind.getByRole("button", { name: "Set up", exact: true }).click()
  await expect(page.getByText("This device is set up")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("region", { name: "This device" })).toContainText("E2E work PC")
  await expect(page.getByText(/Unregistered browser/)).toHaveCount(0)
  await page.goto(`/tasks/${task.ref}`)
  await expect(page.getByRole("button", { name: /^Drive link/ })).toBeEnabled()

  // 4. An admin resets the binding (a new code clears the current setup); Drive goes again.
  await admin.getByRole("button", { name: "Enrolment code for E2E work PC" }).click()
  await expect(admin.getByRole("dialog", { name: "Enrolment code" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: /^Drive link/ })).toBeDisabled()
  await page.goto("/account/security")
  await expect(page.getByText(/Unregistered browser/)).toBeVisible()
})
