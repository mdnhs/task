import { afterEach, describe, expect, test, vi } from "vitest"
import { RECENTS_KEY, recentsKey } from "@/features/search/recents"
import { clearClientStores, clearCompanyScopedStores, clearClientStoresOnce, rearmClientStoresOnce, registerClientStoreReset } from "./client-stores"

const fake = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init))
  return { get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] }
}

describe("clearCompanyScopedStores (T6.9 walk: recent searches survived a company switch)", () => {
  test("removes the recent searches of the app and of the console; keeps the Today choices and anything else", () => {
    const s = fake({ [RECENTS_KEY]: '["TSK-1042"]', [recentsKey("platform")]: '["acme"]', "opsdesk:today:auto:northgate:u1": "1", theme: "dark" })
    clearCompanyScopedStores(s)
    expect(s.keys().sort()).toEqual(["opsdesk:today:auto:northgate:u1", "theme"])
  })
  test("the prefix it clears is the key the search feature writes", () => {
    expect(RECENTS_KEY).toBe("od-search-recents")
    expect(recentsKey("platform").startsWith(`${RECENTS_KEY}:`)).toBe(true)
  })
  test("blocked or missing storage never throws", () => {
    expect(() => clearCompanyScopedStores(null)).not.toThrow()
    expect(() => clearCompanyScopedStores({ get length(): number { throw new Error("blocked") }, key: () => null, removeItem: () => {} })).not.toThrow()
  })
})

describe("B7 T12 clearClientStores(reason): one hook for sign-out, expiry, remote revoke and company switch", () => {
  const jar = (cookies: string) => {
    let all = cookies
    const writes: string[] = []
    return { get cookie() { return all }, set cookie(v: string) { writes.push(v); const name = v.split("=")[0]!; all = all.split("; ").filter((c) => !c.startsWith(`${name}=`)).join("; ") }, writes }
  }
  const TODAY = "od-today-auto-coppers_u1=1; od-today-dismissed-coppers_u1=u1%7C2026-10-24; theme=dark"
  afterEach(() => rearmClientStoresOnce())

  for (const reason of ["sign_out", "expired", "revoked"] as const) {
    test(`${reason}: recents, registered in-memory stores and every Today mirror cookie are cleared; unrelated cookies stay`, () => {
      const s = fake({ [RECENTS_KEY]: "[]", theme: "dark" })
      const j = jar(TODAY)
      const reset = vi.fn()
      registerClientStoreReset(reset)
      clearClientStores(reason, { storage: s, cookies: j })
      expect(s.keys()).toEqual(["theme"])
      expect(reset).toHaveBeenCalled()
      expect(j.writes.map((w) => w.split("=")[0]).sort()).toEqual(["od-today-auto-coppers_u1", "od-today-dismissed-coppers_u1"])
      expect(j.writes.every((w) => /max-age=0/i.test(w) && /path=\//i.test(w))).toBe(true)
    })
  }

  test("tenant_switch clears recents and memory but keeps the keyed Today mirror (it is per tenant and user, switching back finds it)", () => {
    const s = fake({ [RECENTS_KEY]: "[]" })
    const j = jar(TODAY)
    clearClientStores("tenant_switch", { storage: s, cookies: j })
    expect(s.keys()).toEqual([])
    expect(j.writes).toEqual([])
  })

  test("the old shared names (od-today-auto, od-today-dismissed) are cleared too, so a stale one cannot leak across", () => {
    const j = jar("od-today-auto=1; od-today-dismissed=x")
    clearClientStores("sign_out", { storage: fake({}), cookies: j })
    expect(j.writes.map((w) => w.split("=")[0]).sort()).toEqual(["od-today-auto", "od-today-dismissed"])
  })

  test("the once-variant (a dead session seen by many calls at once) clears one time until re-armed", () => {
    const reset = vi.fn()
    registerClientStoreReset(reset)
    const before = reset.mock.calls.length
    clearClientStoresOnce("revoked", { storage: fake({}), cookies: jar("") })
    clearClientStoresOnce("revoked", { storage: fake({}), cookies: jar("") })
    expect(reset.mock.calls.length - before).toBe(1)
  })

  test("blocked cookies never throw", () => {
    const j = { get cookie(): string { throw new Error("blocked") }, set cookie(_v: string) { throw new Error("blocked") } }
    expect(() => clearClientStores("sign_out", { storage: fake({}), cookies: j })).not.toThrow()
  })
})
