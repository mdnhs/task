import { describe, expect, test, vi } from "vitest"
import { ApiError } from "@/lib/api/problem"
import type { TemplateData } from "@opsdesk/domain/shift-report"
import { makeTemplateSession } from "./template-session"

const tpl = (required: boolean): TemplateData => ({ departments: [{ dept: "Night", sections: [{ id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Summary", required }] }] }] })
const flip = (d: TemplateData["departments"]) => d.map((x) => ({ ...x, sections: x.sections.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, required: !f.required })) })) }))

function setup(o: { save?: (d: TemplateData, etag: string | null) => Promise<{ data: TemplateData; etag: string | null }> } = {}) {
  const timers: (() => void)[] = []
  const calls = { saves: [] as { required: boolean; etag: string | null }[], loads: 0 }
  let release: (() => void) | null = null
  const gate = new Promise<void>((r) => (release = r))
  const client = {
    saveReportTemplate: async (d: TemplateData, etag: string | null) => {
      calls.saves.push({ required: d.departments[0]!.sections[0]!.fields[0]!.required, etag })
      return o.save ? o.save(d, etag) : { data: d, etag: `"v${calls.saves.length + 1}"` }
    },
    loadReportTemplate: async () => {
      calls.loads++
      await gate
      return { data: tpl(true), etag: '"server"' }
    },
  }
  const onSaved = vi.fn()
  const onRefused = vi.fn()
  const s = makeTemplateSession({ client, data: tpl(false), etag: '"v1"', setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {}, onChange: () => {}, onSaved, onRefused })
  const fire = async () => {
    while (timers.length) timers.shift()!()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { s, calls, fire, onSaved, onRefused, release: () => release!() }
}
const stale = async () => {
  throw new ApiError(412, "precondition_failed", "r1")
}

describe("report template session (ruling S6)", () => {
  test("a save sends the ETag it holds as If-Match and keeps the new one for the next save", async () => {
    const t = setup()
    t.s.edit((d) => flip(d), "x")
    await t.fire()
    t.s.edit((d) => flip(d), "y")
    await t.fire()
    expect(t.calls.saves.map((c) => c.etag)).toEqual(['"v1"', '"v2"'])
    expect(t.onSaved).toHaveBeenCalledTimes(2)
  })

  test("412 shows the reload banner, sends nothing more, and keeps the form on the server copy after Reload", async () => {
    const t = setup({ save: stale })
    t.s.edit((d) => flip(d), "x") // required: true locally
    await t.fire()
    expect(t.s.snapshot().conflict).toBe("stale")
    t.s.edit((d) => flip(d), "y") // an edit while the banner is open is ignored: nothing silently wins
    await t.fire()
    expect(t.calls.saves).toHaveLength(1)
    t.release()
    await t.s.reload()
    const snap = t.s.snapshot()
    expect(snap.conflict).toBe("none")
    expect(snap.depts).toEqual(tpl(true).departments) // the server copy, not the local edit
    t.s.edit((d) => flip(d), "z")
    await t.fire()
    expect(t.calls.saves.at(-1)!.etag).toBe('"server"') // the next save is under the server's tag
    expect(t.onRefused).not.toHaveBeenCalled() // a 412 is the banner's job, not a toast
  })

  test("Reload is single-flight: a double click fires one fetch", async () => {
    const t = setup({ save: stale })
    t.s.edit((d) => flip(d), "x")
    await t.fire()
    const a = t.s.reload()
    const b = t.s.reload()
    t.release()
    await Promise.all([a, b])
    expect(t.calls.loads).toBe(1)
  })

  test("a refusal other than 412 reverts to what the API holds and reports it", async () => {
    const t = setup({ save: async () => { throw new ApiError(422, "invalid_template", "r") } })
    t.s.edit((d) => flip(d), "x")
    await t.fire()
    expect(t.s.snapshot().depts).toEqual(tpl(false).departments)
    expect(t.s.snapshot().conflict).toBe("none")
    expect(t.onRefused).toHaveBeenCalledTimes(1)
  })
})
