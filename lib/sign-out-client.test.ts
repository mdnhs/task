import { describe, expect, test } from "vitest"
import { SIGN_IN_PATH, runSignOut } from "@/lib/sign-out-client"

describe("runSignOut: the one browser sign-out, from the account menu and the MFA gate card", () => {
  test("clears this browser's stores, calls the server action, then does a full navigation to /sign-in", async () => {
    const log: string[] = []
    await runSignOut({ clear: () => log.push("clear"), action: async () => { log.push("action") }, assign: (to) => log.push(`go:${to}`) })
    expect(log).toEqual(["clear", "action", `go:${SIGN_IN_PATH}`])
    expect(SIGN_IN_PATH).toBe("/sign-in")
  })
  test("still leaves the page when the action rejects, hangs on a refused API call, or only soft-redirects", async () => {
    for (const action of [async () => { throw new Error("network") }, async () => {}]) {
      const gone: string[] = []
      await runSignOut({ clear: () => {}, action, assign: (to) => gone.push(to) })
      expect(gone).toEqual(["/sign-in"])
    }
    const gone: string[] = []
    await runSignOut({ clear: () => {}, action: () => new Promise<void>(() => {}), assign: (to) => gone.push(to), waitMs: 20 })
    expect(gone).toEqual(["/sign-in"])
  })
  test("a failing clear never blocks the sign-out", async () => {
    const gone: string[] = []
    await runSignOut({ clear: () => { throw new Error("storage") }, action: async () => {}, assign: (to) => gone.push(to) })
    expect(gone).toEqual(["/sign-in"])
  })
})
