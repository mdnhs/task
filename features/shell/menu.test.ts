import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { userMenu } from "./menu"
import type { ShellSession, UserData } from "./types"
import type { Role, Tenant } from "@/lib/types"

const role = { id: "manager", label: "Manager", description: "", home: "manager", access: {} } as unknown as Role
const t = (slug: string, name: string): Tenant => ({ id: slug, slug, name, initials: "X", brand: "#1a8a3a", status: "active", plan: "Business" })
const user: UserData = { name: "Ana Byrne", role: "Manager", email: "ana@x.ie", initials: "AB" }
const session = (over: Partial<ShellSession> = {}): ShellSession => ({ role, roles: [role], tenant: t("alpha", "Alpha"), tenants: [t("alpha", "Alpha")], ...over })

describe("T6.3 the shell's user menu", () => {
  test("a user with one membership sees no company switcher; with two, both are listed and the current one is marked", () => {
    expect(userMenu(session(), user, "app").companies).toBeNull()
    const two = userMenu(session({ tenants: [t("alpha", "Alpha"), t("bravo", "Bravo")] }), user, "app")
    expect(two.companies).toEqual([{ slug: "alpha", name: "Alpha", current: true }, { slug: "bravo", name: "Bravo", current: false }])
  })

  test("the console (platform variant) never shows the company switcher or the device", () => {
    const s = session({ tenants: [t("alpha", "Alpha"), t("bravo", "Bravo")], device: { label: "Company PC", registered: true } })
    const m = userMenu(s, user, "platform")
    expect(m.companies).toBeNull()
    expect(m.device).toBeNull()
  })

  test("the device chip shows the label the API sent (read-only); the unregistered browser is flagged", () => {
    expect(userMenu(session({ device: { label: "Company PC", registered: true } }), user, "app").device).toEqual({ label: "Company PC", registered: true })
    expect(userMenu(session({ device: { label: "Unregistered browser", registered: false } }), user, "app").device).toEqual({ label: "Unregistered browser", registered: false })
    expect(userMenu(session(), user, "app").device).toBeNull()
  })

  test("the role line is the membership role (no previewed role)", () => {
    expect(userMenu(session(), user, "app").roleLine).toBe("Manager")
    expect(userMenu(session(), { ...user, role: "Staff · Platform" }, "platform").roleLine).toBe("Staff · Platform")
  })

  test("no 'View as' and no 'Device (preview)' switcher exist in the shell sources, and the demo actions are not imported", () => {
    const src = readFileSync(new URL("./components/nav-user.tsx", import.meta.url), "utf8")
    for (const gone of ["View as", "Device (preview)", "setRole", "setDevice", "setTenant", "Demo preview"]) expect(src, gone).not.toContain(gone)
    expect(src).toContain("switchTenant")
    expect(src).toContain("signOutAction")
  })
})
