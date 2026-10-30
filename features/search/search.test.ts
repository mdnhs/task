import { describe, expect, it } from "vitest"

import type { Access, Module, Role } from "@/lib/types"

import { isInsideSearch, LAYER_ATTR } from "./containment"
import { buildIndex, filterActionsForRole, filterIndexForRole, filterPopularForRole, type RawSources } from "./build"
import { EMPTY_FILTERS, applyFilters, countFilters, filterChips, groupResults, highlight, removeLastFilter, scoreItem, searchItems } from "./match"
import { RECENTS_KEY, pushRecent, readRecents, recentsKey, removeRecent, writeRecents } from "./recents"
import { isFilterShortcut, isMacPlatform, isNewTabEnter, isSlashShortcut, isToggleShortcut, isTypingTarget } from "./shortcuts"

const mods: Module[] = ["dashboard", "tasks", "reports", "attention", "staff", "recruitment", "files", "payroll", "orders", "settings", "audit"]
const role = (home: Role["home"], over: Partial<Record<Module, Access>>): Role => ({
  id: home,
  label: home,
  description: "",
  home,
  access: Object.fromEntries(mods.map((m) => [m, over[m] ?? "none"])) as Record<Module, Access>,
})
const all = (a: Access) => Object.fromEntries(mods.map((m) => [m, a])) as Record<Module, Access>

const src: RawSources = {
  people: [
    { id: "p-me", name: "Me Person" },
    { id: "p-other", name: "Other Person" },
  ],
  tasks: [
    { ref: "TSK-1001", title: "Fire alarm test, Canary Wharf", dept: "Security", assignee: "p-me", status: "completed", due: "2026-10-12T17:00:00" },
    { ref: "TSK-1002", title: "Deep clean lobby", dept: "Cleaning", assignee: "p-other", status: "in_progress", due: "2026-10-20T17:00:00" },
  ],
  reports: [{ id: "RPT-1", date: "2026-10-20", dept: "Cleaning", owner: "p-other", status: "draft" }],
  issues: [{ id: "ATT-301", title: "Approve overtime for Canary Wharf", dept: "Security", owner: "Other Person", status: "open", due: "2026-10-21" }],
  payroll: [{ ref: "PAY-1001", staff: "M. Haddad", dept: "Security", type: "missed_hours", owner: "Priya", status: "open", target: "2026-10-22T17:00:00" }],
  orders: [{ ref: "ORD-1", item: "Supplies order", supplier: "Bunzl", dept: "Cleaning", requester: "Tom", approval: "pending", delivery: "not_ordered", expected: "2026-10-26" }],
  staff: [{ id: "s-1", name: "M. Haddad", role: "Security Officer", dept: "Security" }],
  candidates: [{ id: "CND-1", name: "Marcus Bell", role: "Security Officer", dept: "Security", stage: "applied", owner: "Priya", applied: "2026-10-19" }],
  clients: [{ id: "CLT-1", client: "Canary Wharf Estates", site: "Canary Wharf", dept: "Security", contractRef: "CTR-1", docStatus: "complete", updated: "2026-10-02" }],
  documents: [{ id: "DOC-1", type: "SIA licence", staff: "M. Haddad", dept: "Security", status: "expiring", expiry: "2026-11-01" }],
}
const index = buildIndex(src)

describe("buildIndex", () => {
  it("indexes every source with the item shape", () => {
    expect(index).toHaveLength(10)
    const t = index.find((i) => i.ref === "TSK-1001")!
    expect(t).toEqual({
      id: "task:TSK-1001", type: "task", title: "Fire alarm test, Canary Wharf", ref: "TSK-1001", href: "/tasks/TSK-1001",
      dept: "Security", owner: "Me Person", owners: ["Me Person"], status: "completed", date: "2026-10-12T17:00:00",
    })
    expect(index.find((i) => i.type === "report")!.owner).toBe("Other Person")
    expect(new Set(index.map((i) => i.id)).size).toBe(index.length)
  })
})

describe("filterIndexForRole", () => {
  it("drops payroll for roles without payroll access", () => {
    const admin = role("manager", { ...all("read"), payroll: "none" })
    const out = filterIndexForRole(index, admin, { name: "Me Person" })
    expect(out.some((i) => i.type === "payroll")).toBe(false)
    expect(out).toHaveLength(9)
  })
  it("keeps payroll for roles that can read it", () => {
    expect(filterIndexForRole(index, role("manager", all("read")), { name: "x" }).some((i) => i.type === "payroll")).toBe(true)
  })
  it("scopes staff-home roles to their own tasks and reports and hides other modules", () => {
    const emp = role("staff", { tasks: "write", reports: "write", dashboard: "read" })
    const out = filterIndexForRole(index, emp, { name: "Me Person" })
    expect(out.map((i) => i.id)).toEqual(["task:TSK-1001"])
  })
  it("leaves archived tasks out and lets every assignee find a shared task", () => {
    const more = buildIndex({
      ...src,
      tasks: [
        ...src.tasks,
        { ref: "TSK-1003", title: "Shared patrol", dept: "Security", assignee: "p-other", assignees: ["p-me"], status: "in_progress", due: "2026-10-21T17:00:00" },
        { ref: "TSK-1004", title: "Old job", dept: "Security", assignee: "p-me", archivedAt: "2026-10-12T11:00:00", status: "not_started", due: "2026-10-21T17:00:00" },
      ],
    })
    expect(more.some((i) => i.ref === "TSK-1004")).toBe(false)
    const emp = role("staff", { tasks: "write", reports: "write", dashboard: "read" })
    expect(filterIndexForRole(more, emp, { name: "Me Person" }).map((i) => i.id)).toEqual(["task:TSK-1001", "task:TSK-1003"])
  })
  it("filters quick actions by read / write access", () => {
    const actions = [
      { id: "a", label: "Tasks", href: "/tasks", icon: "task" },
      { id: "b", label: "New task", href: "/tasks?new=1", icon: "plus", write: true },
      { id: "c", label: "Payroll", href: "/payroll-issues", icon: "wallet" },
    ]
    expect(filterActionsForRole(actions, role("manager", { tasks: "read" })).map((a) => a.id)).toEqual(["a"])
    expect(filterActionsForRole(actions, role("manager", { tasks: "write", payroll: "read" })).map((a) => a.id)).toEqual(["a", "b", "c"])
  })
})

describe("filterPopularForRole", () => {
  it("drops popular terms from modules the role can't read", () => {
    const popular = [
      { term: "Fire alarm", module: "tasks" as const },
      { term: "Supplies order", module: "orders" as const },
      { term: "Missed hours", module: "payroll" as const },
    ]
    expect(filterPopularForRole(popular, role("staff", { tasks: "write" }))).toEqual(["Fire alarm"])
    expect(filterPopularForRole(popular, role("manager", all("read")))).toEqual(["Fire alarm", "Supplies order", "Missed hours"])
  })
})

describe("matching and ranking", () => {
  it("requires every token to match", () => {
    const t = index.find((i) => i.ref === "TSK-1001")!
    expect(scoreItem(t, "fire canary")).toBeGreaterThan(0)
    expect(scoreItem(t, "fire lobby")).toBe(0)
    expect(scoreItem(t, "")).toBe(0)
  })
  it("ranks an exact ref above title mentions", () => {
    const r = searchItems(index, "att-301")
    expect(r[0].ref).toBe("ATT-301")
  })
  it("ranks title prefix above substring and other fields", () => {
    const r = searchItems(index, "canary")
    expect(r.map((i) => i.ref)).toContain("TSK-1001")
    expect(r[0].title.toLowerCase().startsWith("canary")).toBe(true)
  })
  it("matches owner / dept / status fields and is accent-insensitive", () => {
    expect(searchItems(index, "other person").map((i) => i.type)).toEqual(expect.arrayContaining(["task", "report", "issue"]))
    expect(searchItems(index, "licénce").map((i) => i.ref)).toEqual(["DOC-1"])
  })
  it("matches hidden keywords (ids, slugs) and ranks an exact keyword first", () => {
    const base = { type: "tenant" as const, href: "/", dept: "", owner: "", status: "", date: "" }
    const t1 = { ...base, id: "tenant:t1", title: "Northgate", ref: "northgate.example", keywords: "northgate t1" }
    const t10 = { ...base, id: "tenant:t10", title: "Tenbury", ref: "tenbury.example", keywords: "tenbury t10" }
    expect(scoreItem(t1, "t1")).toBeGreaterThan(0)
    expect(searchItems([t10, t1], "t1").map((i) => i.id)).toEqual(["tenant:t1", "tenant:t10"])
    expect(scoreItem({ ...t1, keywords: undefined }, "t1")).toBe(0)
  })
  it("returns nothing for an empty query without filters", () => {
    expect(searchItems(index, "  ")).toEqual([])
  })
  it("groups by type in best-hit order with totals and a row limit", () => {
    const g = groupResults(searchItems(index, "security"), 2)
    expect(g.reduce((n, x) => n + x.total, 0)).toBe(searchItems(index, "security").length)
    expect(g.every((x) => x.items.length <= 2)).toBe(true)
  })
  it("highlights each token run", () => {
    expect(highlight("Fire alarm test", "al te")).toEqual([
      { text: "Fire ", hit: false },
      { text: "al", hit: true },
      { text: "arm ", hit: false },
      { text: "te", hit: true },
      { text: "st", hit: false },
    ])
    expect(highlight("abc", "")).toEqual([{ text: "abc", hit: false }])
  })
})

describe("filters", () => {
  const f = (over: Partial<typeof EMPTY_FILTERS>) => ({ ...EMPTY_FILTERS, ...over })
  it("filters by dept, type, owner, status", () => {
    expect(applyFilters(index, f({ dept: "Cleaning" })).every((i) => i.dept === "Cleaning")).toBe(true)
    expect(applyFilters(index, f({ type: "file" }))).toHaveLength(2)
    expect(applyFilters(index, f({ owner: "Me Person" })).map((i) => i.ref)).toEqual(["TSK-1001"])
    expect(applyFilters(index, f({ status: "open" })).map((i) => i.ref).sort()).toEqual(["ATT-301", "PAY-1001"])
  })
  it("filters by inclusive date range and drops undated items", () => {
    const r = applyFilters(index, f({ from: "2026-10-20", to: "2026-10-21" }))
    expect(r.map((i) => i.ref).sort()).toEqual(["ATT-301", "RPT-1", "TSK-1002"])
  })
  it("lists filtered items for an empty query when a filter is active", () => {
    expect(searchItems(index, "", f({ type: "task" })).map((i) => i.ref)).toEqual(["TSK-1002", "TSK-1001"])
  })
  it("counts, labels and removes the last chip", () => {
    const x = f({ dept: "Security", status: "in_progress", type: "task" })
    expect(countFilters(x)).toBe(3)
    expect(filterChips(x).map((c) => c.label)).toEqual(["Security", "In progress", "Tasks"])
    expect(removeLastFilter(x)).toEqual({ ...x, type: "" })
    expect(removeLastFilter(EMPTY_FILTERS)).toBe(EMPTY_FILTERS)
  })
})

describe("recents", () => {
  it("pushes newest first, de-dupes case-insensitively, caps and ignores blanks", () => {
    let l: string[] = []
    for (const q of ["a", "b", "c", "d", "e", "f", "g"]) l = pushRecent(l, q)
    expect(l).toEqual(["g", "f", "e", "d", "c", "b"])
    expect(pushRecent(["Fire", "x"], "fire")).toEqual(["fire", "x"])
    expect(pushRecent(["x"], "   ")).toEqual(["x"])
    expect(removeRecent(["a", "b"], "a")).toEqual(["b"])
  })
  it("reads and writes through storage", () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
    writeRecents(["a", "b"], s)
    expect(readRecents(s)).toEqual(["a", "b"])
    writeRecents([], s)
    expect(m.has(RECENTS_KEY)).toBe(false)
  })
  it("keeps a separate list per index scope", () => {
    expect(recentsKey("app")).toBe(RECENTS_KEY)
    expect(recentsKey("platform")).toBe(`${RECENTS_KEY}:platform`)
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
    writeRecents(["tenant q"], s, recentsKey("platform"))
    expect(readRecents(s)).toEqual([])
    expect(readRecents(s, recentsKey("platform"))).toEqual(["tenant q"])
  })
  it("survives broken or unavailable storage", () => {
    const boom = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("denied") }, removeItem: () => { throw new Error("denied") } }
    expect(readRecents(boom)).toEqual([])
    expect(() => writeRecents(["a"], boom)).not.toThrow()
    expect(readRecents(null)).toEqual([])
    expect(readRecents({ getItem: () => "{not json", setItem: () => {}, removeItem: () => {} })).toEqual([])
    expect(readRecents({ getItem: () => JSON.stringify([1, "ok"]), setItem: () => {}, removeItem: () => {} })).toEqual(["ok"])
  })
})

describe("shortcuts", () => {
  const k = (over: Partial<Parameters<typeof isToggleShortcut>[0]>) => ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })
  it("detects mac platforms", () => {
    expect(isMacPlatform("MacIntel")).toBe(true)
    expect(isMacPlatform("iPhone")).toBe(true)
    expect(isMacPlatform("Win32")).toBe(false)
    expect(isMacPlatform("Linux x86_64")).toBe(false)
  })
  it("⌘K on mac, Ctrl+K elsewhere", () => {
    expect(isToggleShortcut(k({ metaKey: true }), true)).toBe(true)
    expect(isToggleShortcut(k({ ctrlKey: true }), true)).toBe(false)
    expect(isToggleShortcut(k({ ctrlKey: true }), false)).toBe(true)
    expect(isToggleShortcut(k({ metaKey: true }), false)).toBe(false)
    expect(isToggleShortcut(k({ key: "K", metaKey: true }), true)).toBe(true)
    expect(isToggleShortcut(k({ metaKey: true, shiftKey: true }), true)).toBe(false)
    expect(isToggleShortcut(k({ metaKey: true, isComposing: true }), true)).toBe(false)
    expect(isToggleShortcut(k({}), true)).toBe(false)
  })
  it('"/" only outside text inputs', () => {
    const slash = k({ key: "/" })
    expect(isSlashShortcut(slash, { tagName: "BODY" })).toBe(true)
    expect(isSlashShortcut(slash, null)).toBe(true)
    expect(isSlashShortcut(slash, { tagName: "INPUT" })).toBe(false)
    expect(isSlashShortcut(slash, { tagName: "textarea" })).toBe(false)
    expect(isSlashShortcut(slash, { tagName: "DIV", isContentEditable: true })).toBe(false)
    expect(isSlashShortcut(k({ key: "/", ctrlKey: true }), { tagName: "BODY" })).toBe(false)
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true)
  })
  it("Alt+F opens filters (code-based for mac Option+F)", () => {
    expect(isFilterShortcut(k({ key: "ƒ", code: "KeyF", altKey: true }))).toBe(true)
    expect(isFilterShortcut(k({ key: "f", altKey: true }))).toBe(true)
    expect(isFilterShortcut(k({ key: "f" }))).toBe(false)
    expect(isFilterShortcut(k({ key: "f", altKey: true, metaKey: true }))).toBe(false)
  })
  it("⌘/Ctrl+Enter opens in a new tab", () => {
    expect(isNewTabEnter(k({ key: "Enter", metaKey: true }), true)).toBe(true)
    expect(isNewTabEnter(k({ key: "Enter", ctrlKey: true }), false)).toBe(true)
    expect(isNewTabEnter(k({ key: "Enter", ctrlKey: true }), true)).toBe(false)
    expect(isNewTabEnter(k({ key: "Enter" }), false)).toBe(false)
  })
})

describe("isInsideSearch", () => {
  const root = { contains: (n: unknown) => n === inRoot }
  const inRoot = { closest: () => null }
  it("counts the search root and its own marked portals as inside", () => {
    expect(isInsideSearch(inRoot, root)).toBe(true)
    expect(isInsideSearch({ closest: (sel: string) => (sel === `[${LAYER_ATTR}]` ? {} : null) }, root)).toBe(true)
  })
  it("treats the page, sidebar and other popups as outside", () => {
    expect(isInsideSearch({ closest: () => null }, root)).toBe(false)
    expect(isInsideSearch({}, root)).toBe(false)
    expect(isInsideSearch(null, root)).toBe(false)
    expect(isInsideSearch({ closest: () => null }, null)).toBe(false)
  })
})
