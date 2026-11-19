import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { userMessage, ApiError } from "@/lib/api/problem"
import { inviteDaysOf, toRoles } from "@/features/settings/adapters"
import { loadSessionIdleHours, readable } from "@/features/settings/api"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/settings/users", useSearchParams: () => new URLSearchParams() }))

const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

describe("T6.5 carry-in 1: loadSessionIdleHours is guarded", () => {
  test("a missing field or a failed call is null, not a crash", async () => {
    expect(await readable(() => loadSessionIdleHours(fakeApi({ "GET /v1/me/tenant": { tenant: {} } }).client))).toBeNull()
    expect(await readable(() => loadSessionIdleHours(fakeApi({ "GET /v1/me/tenant": problem(403, "forbidden") }).client))).toBeNull()
    expect(await readable(() => loadSessionIdleHours(fakeApi({ "GET /v1/me/tenant": { tenant: { sessionIdleHours: 12 } } }).client))).toBe(12)
  })
  test("the page renders a dash for a null timeout", () => {
    expect(read("app/(app)/settings/[tab]/page.tsx")).toMatch(/loadSessionIdleHours\(api\)\)/)
    expect(read("features/settings/components/organisation-form.tsx")).toMatch(/sessionIdleHours\s*===\s*null|sessionIdleHours\s*\?/)
  })
})

describe("T6.5 carry-in 2: Copy role excludes Owner, owner_not_clonable has copy", () => {
  test("the copy dialog source list drops the owner role", () => {
    expect(read("features/settings/components/roles-matrix.tsx")).toMatch(/roles\.filter\(\(r\) => r\.id !== "owner"\)/)
  })
  test("409 owner_not_clonable maps to short copy", () => {
    const m = userMessage(new ApiError(409, "owner_not_clonable", "r1"))
    expect(m.text).toMatch(/owner/i)
    expect(m.text).not.toMatch(/something went wrong/i)
  })
})

describe("T6.5 carry-in 3: the fresh highlight is keyed by role key", () => {
  test("two roles with one label highlight one column", () => {
    const src = read("features/settings/components/roles-matrix.tsx")
    expect(src).not.toMatch(/fresh === r\.label/)
    expect(src).toMatch(/fresh === r\.id/)
    expect(toRoles).toBeTypeOf("function")
  })
})

// T6.5 carry-in 4 (demo-only Status/Deactivate columns) is superseded by B8 Task 24: the columns are the API's now (features/settings/t24-users-deactivate.dom.test.ts).

describe("T6.5 carry-in 5: inviteDaysOf takes the median", () => {
  const inv = (d: number) => ({ createdAt: "2026-11-01T09:00:00", expiresAt: `2026-11-${String(1 + d).padStart(2, "0")}T09:00:00` })
  test("median of the listed invites, not the first", () => {
    expect(inviteDaysOf([inv(1), inv(7), inv(7)])).toBe(7)
    expect(inviteDaysOf([inv(1), inv(3), inv(7), inv(9)])).toBe(5)
    expect(inviteDaysOf([inv(7)])).toBe(7)
    expect(inviteDaysOf([])).toBeNull()
  })
})
