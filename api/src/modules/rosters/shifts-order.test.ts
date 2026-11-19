import { beforeEach, describe, expect, test, vi } from "vitest"
import { sql } from "drizzle-orm"
import { resetDb } from "../../../test/harness"
import { sites } from "./testkit"

// B8 Task 9/10: the lock order of every roster mutation, observed at runtime: lockRoster FIRST, then lockActor, then the rule engine runs UNDER the held lock.

const calls: string[] = []
vi.mock("./scope", async (orig) => {
  const m = await orig<typeof import("./scope")>()
  return { ...m, lockRoster: async (...a: Parameters<typeof m.lockRoster>) => { calls.push("lockRoster"); return m.lockRoster(...a) } }
})
vi.mock("../rbac", async (orig) => {
  const m = await orig<typeof import("../rbac")>()
  return { ...m, lockActor: async (...a: Parameters<typeof m.lockActor>) => { calls.push("lockActor"); return m.lockActor(...a) } }
})
/** checkWeek must run with the tenant's roster advisory lock held by ITS OWN transaction (a lock-free dry-run reader would not). */
const checkLocks: boolean[] = []
vi.mock("./rules", async (orig) => {
  const m = await orig<typeof import("./rules")>()
  return {
    ...m,
    checkWeek: async (...a: Parameters<typeof m.checkWeek>) => {
      const [tx] = a
      const r = (await tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted`)) as unknown as { rows: { n: number }[] }
      checkLocks.push(r.rows[0].n > 0)
      calls.push("checkWeek")
      return m.checkWeek(...a)
    },
  }
})

beforeEach(async () => {
  await resetDb()
  calls.length = 0
  checkLocks.length = 0
})

describe("lock order of the week and shift writes", () => {
  test("every mutation takes lockRoster before lockActor; add, move and publish-checks run checkWeek only while that lock is held", async () => {
    const w = await sites()
    calls.length = 0
    const wk = await w.week(w.p.owner, w.a, "2026-11-09")
    expect(calls).toEqual(["lockRoster", "lockActor"]) // create week (a second create is also a write)
    calls.length = 0
    const added = await w.addOk(w.p.owner, wk, [{ date: "2026-11-09", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    expect(calls.slice(0, 2)).toEqual(["lockRoster", "lockActor"])
    expect(calls.filter((c) => c === "checkWeek").length).toBe(2) // before and after
    calls.length = 0
    await w.ok("PATCH", `/v1/roster/shifts/${added.shifts[0].id}`, w.p.owner, { version: 1, patch: { start: "09:00" } })
    expect(calls.slice(0, 2)).toEqual(["lockRoster", "lockActor"])
    expect(calls.filter((c) => c === "checkWeek").length).toBe(2)
    calls.length = 0
    expect((await w.req("DELETE", `/v1/roster/shifts/${added.shifts[0].id}?version=2`, w.p.owner)).status).toBe(204)
    expect(calls).toEqual(["lockRoster", "lockActor"])
    expect(checkLocks.length).toBe(4)
    expect(checkLocks.every(Boolean)).toBe(true)
    // a read takes neither
    calls.length = 0
    await w.ok("GET", `/v1/roster/weeks/${wk}`, w.p.owner)
    expect(calls).toEqual([])
  })
})
