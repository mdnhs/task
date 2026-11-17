import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { resetDb, testApp } from "../../../test/harness"
import { ownerDb, ownerQuery, testDb } from "../../../test/db"
import { makeTenant } from "../../../test/factories"
import { countAll, demoOptions, secondDatabase } from "../../../test/seed-support"
import type { Db } from "../../db/client"
import { assertSameDatabase, assertSeedAllowed, SeedRefused } from "./guards"
import { seedDemo, seedDemoInternal } from "./seed"

const refusal = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    if (e instanceof SeedRefused) return e.code
    throw e
  }
  return "allowed"
}
const counts = async (app: Db, owner: Db) => {
  const n = async (d: Db, t: string) => Number(((await d.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0] as { n: number }).n)
  return [await n(app, "tenants"), await n(app, '"user"'), await n(owner, "tenants"), await n(owner, '"user"'), await n(owner, "account")]
}

let other: { app: Db; owner: Db }
beforeAll(async () => {
  other = await secondDatabase()
}, 180_000)
beforeEach(async () => {
  await resetDb()
  for (const t of ["account", "session", '"user"', "tenants"]) await other.owner.execute(sql.raw(`truncate table ${t} cascade`))
})

describe("the guard and the deleting connection are the same database (J5)", () => {
  test("the same database passes; two different databases are refused, both ways round, and nothing is written in either", async () => {
    await assertSameDatabase(testDb(), ownerDb()) // app_user and app_owner of the one test database
    const before = [await counts(testDb(), ownerDb()), await counts(other.app, other.owner)]
    // app_user -> main database, owner -> the other one
    expect(await refusal(seedDemo(testDb(), await demoOptions({ owner: other.owner })))).toBe("connections_differ")
    // app_user -> the other database, owner -> main
    expect(await refusal(seedDemo(other.app, await demoOptions({ owner: ownerDb() })))).toBe("connections_differ")
    expect([await counts(testDb(), ownerDb()), await counts(other.app, other.owner)]).toEqual(before)
    expect(await countAll("tasks")).toBe(0)
  }, 120_000)

  test("a foreign tenant on the OWNER's database is seen even when app_user's database is empty: the guard runs on both connections", async () => {
    // (pointing the connections at different databases is refused anyway; this checks the owner side is really inspected)
    const t = testApp()
    await makeTenant(t.deps, { slug: "real-customer" })
    expect(await refusal(assertSeedAllowed(ownerDb(), { env: { ALLOW_DEMO_SEED: "1" }, emailDomain: "demo.example" }))).toBe("other_tenants")
    expect(await refusal(assertSeedAllowed(testDb(), { env: { ALLOW_DEMO_SEED: "1" }, emailDomain: "demo.example" }))).toBe("other_tenants")
    expect(await refusal(seedDemo(testDb(), await demoOptions()))).toBe("other_tenants")
  })

  test("a foreign tenant created after the first check but before the lock is caught by the re-check, and nothing is written", async () => {
    const t = testApp()
    const before = await counts(testDb(), ownerDb())
    const err = await refusal(
      seedDemoInternal(testDb(), await demoOptions(), {
        beforeLock: async () => {
          await makeTenant(t.deps, { slug: "created-in-the-window" }) // the first guard has passed; this lands before the lock
        },
      }),
    )
    expect(err).toBe("other_tenants")
    const [tenantsBefore, usersBefore] = before
    expect((await counts(testDb(), ownerDb())).slice(0, 2)).toEqual([tenantsBefore + 1, usersBefore]) // only the foreign tenant the test made: no demo tenant, no user
    expect(Number((await ownerQuery("select count(*)::int as n from tenants where slug in ('northgate','harbourline','millbrook')"))[0].n)).toBe(0)
    expect(await countAll("tasks")).toBe(0)
    expect(Number((await ownerQuery("select count(*)::int as n from account"))[0].n)).toBe(0)
  })

  test("two seeds never interleave: the second waits for the lock the first holds", async () => {
    const order: string[] = []
    const a = seedDemoInternal(testDb(), await demoOptions(), { beforeLock: async () => void order.push("a-start") })
    const b = seedDemoInternal(testDb(), await demoOptions({ owner: ownerDb() }), { beforeLock: async () => void order.push("b-start") })
    const settled = await Promise.allSettled([a, b])
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true) // b re-seeds after a (owner given), never in the middle of it
    expect(Number((await ownerQuery("select count(*)::int as n from tenants"))[0].n)).toBe(3)
  }, 180_000)
})
