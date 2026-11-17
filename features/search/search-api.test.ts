import { describe, expect, test, vi } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { applyFilters, EMPTY_FILTERS, groupResults } from "./match"
import { hitsToItems, makeSearcher, mockSearchEnabled } from "./adapters"

const HITS = [
  { entity: "task", entityId: "11111111-1111-4111-8111-111111111111", title: "TSK-1042 Fire alarm test", module: "tasks" },
  { entity: "report", entityId: "22222222-2222-4222-8222-222222222222", title: "Night shift 2026-11-17", module: "reports" },
  { entity: "member", entityId: "usr_1", title: "Ada Byrne", module: "settings" },
  { entity: "widget", entityId: "x", title: "Unknown kind", module: "settings" },
]

describe("T6.5 search: API hits map to SearchItems", () => {
  test("each known entity gets a type and an href; facets are empty; an unknown entity is dropped", () => {
    const items = hitsToItems(HITS)
    expect(items.map((i) => [i.type, i.href])).toEqual([
      ["task", "/tasks/TSK-1042"],
      ["report", "/daily-reports/22222222-2222-4222-8222-222222222222"],
      ["member", "/settings/users"],
    ])
    expect(items[0]).toMatchObject({ title: "TSK-1042 Fire alarm test", ref: "TSK-1042", dept: "", owner: "", status: "", date: "" })
    expect(items.every((i) => i.id.startsWith("api:"))).toBe(true)
  })
  test("hits appear grouped by type", () => {
    const groups = groupResults(hitsToItems(HITS))
    expect(groups.map((g) => g.type).sort()).toEqual(["member", "report", "task"])
  })
  test("a facet filter drops hits that have no facets (documented limit, B11 adds facets)", () => {
    const items = hitsToItems(HITS)
    expect(applyFilters(items, { ...EMPTY_FILTERS, dept: "Security" })).toEqual([])
    expect(applyFilters(items, { ...EMPTY_FILTERS, status: "open" })).toEqual([])
    expect(applyFilters(items, { ...EMPTY_FILTERS, type: "task" }).map((i) => i.type)).toEqual(["task"]) // a type filter still works
    expect(applyFilters(items, EMPTY_FILTERS)).toHaveLength(3)
  })
})

describe("T6.5 search: debounce 150 ms, 2+ characters, the previous request is aborted", () => {
  const timers = () => {
    const q: { at: number; fn: () => void; id: number }[] = []
    let now = 0
    let n = 0
    return {
      set: (fn: () => void, ms: number) => (q.push({ at: now + ms, fn, id: ++n }), n),
      clear: (id: unknown) => void q.splice(0, q.length, ...q.filter((t) => t.id !== id)),
      advance: (ms: number) => {
        now += ms
        for (const t of q.filter((x) => x.at <= now)) {
          q.splice(q.indexOf(t), 1)
          t.fn()
        }
      },
    }
  }

  test("a query under 2 characters makes no request", async () => {
    const { client, calls } = fakeApi({ "GET /v1/search": { hits: HITS } })
    const t = timers()
    const s = makeSearcher({ api: client, setTimer: t.set, clearTimer: t.clear })
    const p = s.search("a")
    t.advance(500)
    expect(await p).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test("one request after the pause, with the trimmed query and a limit", async () => {
    const { client, calls } = fakeApi({ "GET /v1/search": { hits: HITS } })
    const t = timers()
    const s = makeSearcher({ api: client, setTimer: t.set, clearTimer: t.clear })
    const p = s.search("  fire ")
    t.advance(149)
    expect(calls).toHaveLength(0)
    t.advance(1)
    const items = await p
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: "/v1/search", query: { q: "fire", limit: "20" } })
    expect(items).toHaveLength(3)
  })

  test("two quick keystrokes: the first request never runs (debounced) and a first request already in flight is aborted", async () => {
    const signals: AbortSignal[] = []
    const api = { get: vi.fn(async (_p: string, o: { query: { q: string }; signal?: AbortSignal }) => {
      signals.push(o.signal!)
      await new Promise((r) => setTimeout(r, 5))
      if (o.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" })
      return { hits: [{ entity: "task", entityId: "11111111-1111-4111-8111-111111111111", title: `TSK-1 ${o.query.q}`, module: "tasks" }] }
    }) } as never
    const t = timers()
    const s = makeSearcher({ api, setTimer: t.set, clearTimer: t.clear })
    const first = s.search("fi")
    t.advance(150) // the first request starts
    const second = s.search("fire")
    t.advance(150)
    const [a, b] = await Promise.all([first, second])
    expect(signals).toHaveLength(2)
    expect(signals[0]!.aborted).toBe(true)
    expect(a).toBeNull() // superseded: the caller ignores it
    expect(b!.map((i) => i.title)).toEqual(["TSK-1 fire"])
    // typing again inside the pause cancels the timer: only the last query is sent
    const calls0 = (api as { get: ReturnType<typeof vi.fn> }).get.mock.calls.length
    const x = s.search("ab")
    t.advance(100)
    const y = s.search("abc")
    t.advance(150)
    expect(await x).toBeNull()
    await y
    expect((api as { get: ReturnType<typeof vi.fn> }).get.mock.calls.length - calls0).toBe(1)
  })

  test("a failed request is an empty result, not a crash", async () => {
    const { client } = fakeApi({})
    const t = timers()
    const s = makeSearcher({ api: client, setTimer: t.set, clearTimer: t.clear })
    const p = s.search("fire")
    t.advance(150)
    expect(await p).toEqual([])
  })
})

describe("T6.5 search: mock kinds only when mock modules are enabled", () => {
  test("mockSearchEnabled follows ENABLE_MOCK_MODULES=1 exactly", () => {
    expect(mockSearchEnabled({ ENABLE_MOCK_MODULES: "1" })).toBe(true)
    for (const v of [undefined, "", "0", "true", "yes"]) expect(mockSearchEnabled({ ENABLE_MOCK_MODULES: v })).toBe(false)
  })
})
