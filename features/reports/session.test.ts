import { describe, expect, test, vi } from "vitest"
import { ApiError } from "@/lib/api/problem"
import { TZ, reportDto } from "@/test/support/report-dto"
import { toReport } from "./adapters"
import { makeDraftSession } from "./session"
import type { ShiftReport } from "./types"

const at = (v: number, summary = "") => toReport(reportDto({ version: v, summary }), TZ)
const submittedDto = (v: number) => toReport(reportDto({ status: "submitted", state: "submitted", version: v, submissions: 1 }), TZ)

function setup(o: { saves?: (f: ShiftReport, v: number) => Promise<ShiftReport>; server?: ShiftReport; submit?: (r: ShiftReport, id: string) => Promise<ShiftReport> } = {}) {
  const timers: (() => void)[] = []
  const calls = { saves: [] as { summary: string; version: number }[], submits: [] as { id: string; version: number }[], gets: 0 }
  let server = o.server ?? at(2, "theirs")
  const client = {
    saveDraft: async (f: ShiftReport) => {
      calls.saves.push({ summary: f.summary, version: f.version })
      if (o.saves) return o.saves(f, f.version)
      return { ...f, version: f.version + 1 }
    },
    get: async () => (calls.gets++, server),
    submit: async (r: ShiftReport, id: string) => {
      calls.submits.push({ id, version: r.version })
      if (o.submit) return o.submit(r, id)
      return submittedDto(r.version + 1)
    },
  }
  let n = 0
  const states: unknown[] = []
  const s = makeDraftSession({
    client, report: at(1), setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {}, newId: () => `id-${++n}`, onChange: (x) => states.push(x), onError: vi.fn(),
  })
  const fire = async () => {
    while (timers.length) timers.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { s, calls, fire, setServer: (r: ShiftReport) => (server = r), states }
}
const conflict = async () => {
  throw new ApiError(409, "version_conflict", "r1")
}

describe("a version conflict never discards the user's text (O1)", () => {
  test("an autosave conflict keeps the local text, takes the server version and shows the banner", async () => {
    const t = setup({ saves: conflict })
    t.s.edit({ ...t.s.snapshot().form, summary: "my long summary" })
    await t.fire()
    const snap = t.s.snapshot()
    expect(snap.form.summary).toBe("my long summary")
    expect(snap.conflict?.version).toBe(2)
    expect(snap.conflict?.summary).toBe("theirs")
    expect(t.calls.gets).toBe(1)
  })
  test("typing while the banner is open keeps the newest text and sends nothing", async () => {
    const t = setup({ saves: conflict })
    t.s.edit({ ...t.s.snapshot().form, summary: "a" })
    await t.fire()
    t.s.edit({ ...t.s.snapshot().form, summary: "a and more" })
    await t.fire()
    expect(t.calls.saves).toHaveLength(1)
    expect(t.s.snapshot().form.summary).toBe("a and more")
  })
  test("Keep mine saves the local text on the NEW version", async () => {
    let first = true
    const t = setup({ saves: async (f) => { if (first) { first = false; return conflict() } return { ...f, version: f.version + 1 } } })
    t.s.edit({ ...t.s.snapshot().form, summary: "mine" })
    await t.fire()
    await t.s.keepMine()
    expect(t.calls.saves.at(-1)).toEqual({ summary: "mine", version: 2 })
    expect(t.s.snapshot().conflict).toBeNull()
    expect(t.s.snapshot().form.summary).toBe("mine")
  })
  test("Reload theirs replaces the form with the server data and saves nothing", async () => {
    const t = setup({ saves: conflict })
    t.s.edit({ ...t.s.snapshot().form, summary: "mine" })
    await t.fire()
    t.s.reloadTheirs()
    expect(t.s.snapshot().form.summary).toBe("theirs")
    expect(t.s.snapshot().conflict).toBeNull()
    expect(t.calls.saves).toHaveLength(1)
    t.s.edit({ ...t.s.snapshot().form, summary: "theirs edited" })
    await t.fire()
    expect(t.calls.saves.at(-1)).toEqual({ summary: "theirs edited", version: 2 })
  })
  test("a submit after an autosave conflict neither calls the API nor reloads twice: it waits for the choice", async () => {
    const t = setup({ saves: conflict })
    t.s.edit({ ...t.s.snapshot().form, summary: "mine" })
    await t.fire()
    expect(await t.s.submit()).toEqual({ kind: "choose" })
    expect(t.calls.submits).toHaveLength(0)
    expect(t.calls.gets).toBe(1)
  })
  test("a submit conflict keeps the text, shows the banner, and Keep mine then a new submit uses a NEW request id on the new version", async () => {
    let first = true
    const t = setup({
      submit: async (r) => {
        if (first) { first = false; return conflict() }
        return submittedDto(r.version + 1)
      },
    })
    t.s.edit({ ...t.s.snapshot().form, summary: "mine" })
    expect(await t.s.submit()).toEqual({ kind: "conflict" })
    expect(t.s.snapshot().form.summary).toBe("mine")
    expect(t.s.snapshot().conflict?.version).toBe(2)
    await t.s.keepMine()
    const r = await t.s.submit()
    expect(r.kind).toBe("ok")
    expect(t.calls.submits.map((x) => x.id)).toEqual(["id-1", "id-2"])
    expect(t.calls.submits.map((x) => x.version)).toEqual([2, 3]) // keepMine saved on version 2 -> 3
    expect(t.calls.gets).toBe(1)
  })
  test("a network retry of the same attempt keeps its request id", async () => {
    let n = 0
    const t = setup({ submit: async (r) => { if (++n === 1) throw new TypeError("fetch failed"); return submittedDto(r.version + 1) } })
    await expect(t.s.submit()).rejects.toBeInstanceOf(TypeError)
    expect((await t.s.submit()).kind).toBe("ok")
    expect(t.calls.submits.map((x) => x.id)).toEqual(["id-1", "id-1"])
  })
})
