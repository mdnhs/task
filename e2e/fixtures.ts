import { expect, request, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { statePath } from "./paths"
import { WEB_ORIGIN, type Persona } from "./stack-env"

type Api = { get<T = any>(path: string): Promise<T>; send<T = any>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, data?: unknown, ok?: number[]): Promise<T> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A JSON client for the real API through the web origin (the BFF), signed in as a persona. Used for set-up and read-back only; the acceptance steps go through the UI. */
export async function apiAs(persona: Persona): Promise<Api & { ctx: APIRequestContext }> {
  const ctx = await request.newContext({ baseURL: WEB_ORIGIN, storageState: statePath(persona), extraHTTPHeaders: { origin: WEB_ORIGIN } })
  const unwrap = async (res: Awaited<ReturnType<APIRequestContext["get"]>>, label: string, ok: number[]) => {
    if (!ok.includes(res.status())) throw new Error(`${label} -> ${res.status()} ${(await res.text()).slice(0, 300)}`)
    const t = await res.text()
    return t ? JSON.parse(t) : null
  }
  return {
    ctx,
    get: async (path) => unwrap(await ctx.get(path), `GET ${path}`, [200]),
    send: async (method, path, data, ok = [200, 201, 204]) => unwrap(await ctx.fetch(path, { method, data }), `${method} ${path}`, ok),
  }
}

type Fixtures = {
  /** A fresh browser context and page signed in as the persona (same device emulation as the project). */
  as(persona: Persona): Promise<Page>
}

export const test = base.extend<Fixtures>({
  as: async ({ browser, baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async (persona) => {
      const ctx = await browser.newContext({ baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, storageState: statePath(persona) })
      contexts.push(ctx)
      return ctx.newPage()
    })
    for (const c of contexts) await c.close()
  },
})
export { expect }

/** Tenant-local date (YYYY-MM-DD) and the weekday-independent "now" parts the specs build wall-clock values from. The demo tenants are Europe/Dublin. */
export function dublinToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** Signs in through the sign-in form (the one UI sign-in each CR spec does), then returns the page. */
export async function signInThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in")
  await page.locator("#si-email").fill(email)
  await page.locator("#si-password").fill(password)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"))
}

/** Types into a collapsible FilterSearch box (opens it first when it is shut). */
export async function search(page: Page, label: string, value: string): Promise<void> {
  const box = page.getByRole("searchbox", { name: label })
  if (!(await box.isVisible())) await page.getByRole("button", { name: label, exact: true }).click()
  await box.fill(value)
}

/** Picks a day (YYYY-MM-DD) in a DatePicker opened from the button with this id. The day buttons are named like "Saturday, November 21st, 2026" (today also carries a prefix). */
export async function pickDate(page: Page, buttonSelector: string, iso: string, scope: Page | ReturnType<Page["locator"]> = page): Promise<void> {
  const [y, m, d] = iso.split("-").map(Number)
  const ord = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"
  const at = new Date(Date.UTC(y, m - 1, d))
  const part = (o: Intl.DateTimeFormatOptions) => at.toLocaleDateString("en-US", { ...o, timeZone: "UTC" })
  const text = `${part({ weekday: "long" })}, ${part({ month: "long" })} ${d}${ord}, ${y}`
  await scope.locator(buttonSelector).first().click()
  await page.getByRole("button", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click()
}

/** The text a screen reader gets from an element: aria-hidden parts (the rolling digits of a count) left out, white space collapsed. */
export async function spokenText(el: ReturnType<Page["locator"]>): Promise<string> {
  return el.evaluate((n) => {
    const c = n.cloneNode(true) as HTMLElement
    c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove())
    return (c.textContent ?? "").replace(/\s+/g, " ").trim()
  })
}
