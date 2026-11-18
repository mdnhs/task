import { beforeEach, describe, expect, test, vi } from "vitest"
import { clearCompanyScopedStores } from "@/lib/client-stores"
import { recentsKey } from "./recents"
import { loadSearch, recentsFor, type SearchData } from "./session-stores"

// A tiny localStorage so the real read/write code paths run in node.
const mem = new Map<string, string>()
const ls = { get length() { return mem.size }, key: (i: number) => [...mem.keys()][i] ?? null, getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
beforeEach(() => {
  mem.clear()
  vi.stubGlobal("window", { localStorage: ls })
  clearCompanyScopedStores(ls)
})

const data = (id: string): SearchData => ({ items: [{ id } as never], config: { popular: [], actions: [] } })

describe("B6 final I1: search state does not survive sign-out or a company switch in the same tab", () => {
  test("recents: B sees none of A's terms, and B's first set() does not rewrite A's", () => {
    const st = recentsFor("app")
    st.set(["alice secret"])
    expect(st.get()).toEqual(["alice secret"])
    const seen = vi.fn()
    st.subscribe(seen)
    clearCompanyScopedStores(ls)
    expect(seen).toHaveBeenCalled()
    expect(st.get()).toEqual([])
    st.set(["bob term"])
    expect(JSON.parse(mem.get(recentsKey("app"))!)).toEqual(["bob term"])
    expect(JSON.stringify([...mem.values()])).not.toContain("alice")
  })
  test("index: the next person's first load refetches instead of reusing A's promise", async () => {
    const load = vi.fn().mockResolvedValueOnce(data("A")).mockResolvedValueOnce(data("B"))
    expect((await loadSearch("app", load)).items[0].id).toBe("A")
    expect((await loadSearch("app", load)).items[0].id).toBe("A")
    expect(load).toHaveBeenCalledTimes(1)
    clearCompanyScopedStores(ls)
    expect((await loadSearch("app", load)).items[0].id).toBe("B")
    expect(load).toHaveBeenCalledTimes(2)
  })
})
