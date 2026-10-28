import { describe, expect, it } from "vitest"

import { createStore } from "./store"

describe("createStore", () => {
  it("is empty until seeded", () => {
    expect(createStore<number[]>().get()).toBeUndefined()
  })

  it("keeps the first seed and ignores later ones", () => {
    const s = createStore<number[]>()
    s.seed([1, 2])
    expect(s.get()).toEqual([1, 2])
    s.seed([9])
    expect(s.get()).toEqual([1, 2])
  })

  it("applies an update function to the previous value", () => {
    const s = createStore<number[]>()
    s.seed([1])
    s.set((prev) => [...prev, 2])
    expect(s.get()).toEqual([1, 2])
  })

  it("notifies subscribers on update and stops after unsubscribe", () => {
    const s = createStore<number>()
    s.seed(0)
    let calls = 0
    const off = s.subscribe(() => calls++)
    s.set((n) => n + 1)
    off()
    s.set((n) => n + 1)
    expect(calls).toBe(1)
    expect(s.get()).toBe(2)
  })

  it("reset clears the value so it can be seeded again", () => {
    const s = createStore<string>()
    s.seed("a")
    s.reset()
    expect(s.get()).toBeUndefined()
    s.seed("b")
    expect(s.get()).toBe("b")
  })

  it("treats an undefined seed as seeded", () => {
    const s = createStore<number | undefined>()
    s.seed(undefined)
    s.seed(5)
    expect(s.get()).toBeUndefined()
    s.set(() => 7)
    expect(s.get()).toBe(7)
  })

  it("replaces the value when seeded under a different scope, and keeps it for the same scope", () => {
    const s = createStore<string>()
    s.seed("staff", "t1:me")
    s.set(() => "edited")
    s.seed("staff again", "t1:me")
    expect(s.get()).toBe("edited")
    s.seed("manager", "t1:all")
    expect(s.get()).toBe("manager")
    s.seed("unscoped")
    expect(s.get()).toBe("manager")
  })
})
