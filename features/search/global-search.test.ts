import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { createLoadGate } from "./load-gen"
import { loadSearch, onSearchReset, resetSearchState, type SearchData } from "./session-stores"

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const data = (id: string): SearchData => ({ items: [{ id } as never], config: { popular: [], actions: [] } })

// Mirrors how global-search.tsx uses the gate: ticket per load, commit only when the ticket is still current, reset invalidates.
function harness() {
  const gate = createLoadGate()
  let committed: SearchData | null = null
  const off = onSearchReset(() => {
    gate.invalidate()
    committed = null
  })
  const start = (scope: string, load: () => Promise<SearchData>) => {
    const live = gate.begin()
    return loadSearch(scope, load).then((d) => {
      if (live()) committed = d
    })
  }
  return { start, get: () => committed, off }
}

describe("search stale in-flight loads", () => {
  it("a load that resolves after reset does not repopulate results", async () => {
    resetSearchState()
    const h = harness()
    const d = deferred<SearchData>()
    const p = h.start("t-reset", () => d.promise)
    resetSearchState()
    d.resolve(data("old"))
    await p
    expect(h.get()).toBeNull()
    h.off()
  })

  it("a load that resolves after company switch does not repopulate results or recents", async () => {
    resetSearchState()
    const h = harness()
    const d = deferred<SearchData>()
    const p = h.start("t-switch", () => d.promise)
    resetSearchState() // the company switch path (registerClientStoreReset -> resetSearchState)
    d.resolve(data("old-company"))
    await p
    expect(h.get()).toBeNull()
    h.off()
  })

  it("two overlapping loads: only the latest generation commits", async () => {
    const gate = createLoadGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
    gate.invalidate()
    expect(second()).toBe(false)
  })

  it("the component takes a ticket for every load and invalidates on reset", () => {
    const src = readFileSync(new URL("./components/global-search.tsx", import.meta.url), "utf8")
    expect(src).toContain("createLoadGate")
    expect(src).toMatch(/onSearchReset\(\(\) => \{[^}]*loadGen\.current\.invalidate\(\)/)
    expect((src.match(/loadGen\.current\.begin\(\)/g) ?? []).length).toBe(2)
    expect(src).not.toMatch(/\.then\(setData/)
  })
})
