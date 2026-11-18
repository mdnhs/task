import { describe, expect, test } from "vitest"
import { RECENTS_KEY, recentsKey } from "@/features/search/recents"
import { clearCompanyScopedStores } from "./client-stores"

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
