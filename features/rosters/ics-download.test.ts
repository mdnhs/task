import { describe, expect, test, vi } from "vitest"
import { downloadMyCalendar } from "./ics-download"

// B8 Task 22 (R8-16): "Add to calendar" asks the API's ONE builder through the BFF (same-origin /v1, the session cookie, the page's tenant) and hands the browser the file as an attachment.
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"
const calendar = () => new Response(ICS, { status: 200, headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="roster.ics"', "x-content-type-options": "nosniff" } })

describe("downloadMyCalendar", () => {
  test("the download button fetches mine.ics through the BFF and the browser receives an attachment", async () => {
    const get = vi.fn<(path: string) => Promise<Response>>(async () => calendar())
    const save = vi.fn()
    const r = await downloadMyCalendar({ from: "2026-11-16", to: "2026-12-13" }, { get, save })
    expect(r).toEqual({ ok: true, filename: "roster.ics" })
    expect(get).toHaveBeenCalledWith("/v1/roster/mine.ics?from=2026-11-16&to=2026-12-13") // relative: the BFF, never the API host
    const [blob, name] = save.mock.calls[0] as [Blob, string]
    expect(name).toBe("roster.ics")
    expect(blob.type).toBe("text/calendar;charset=utf-8")
    expect(await blob.text()).toBe(ICS) // the API's bytes, not rebuilt here
  })

  test("a refusal (429, 422 problem) or a network failure is a short state; nothing is saved", async () => {
    const save = vi.fn()
    const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r1" }), { status, headers: { "content-type": "application/problem+json" } })
    const limited = await downloadMyCalendar({ from: "2026-11-16", to: "2026-12-13" }, { get: async () => problem(429, "rate_limited"), save })
    expect(limited).toMatchObject({ ok: false, error: { state: "rate_limited" } })
    const range = await downloadMyCalendar({ from: "2026-11-16", to: "2026-12-13" }, { get: async () => problem(422, "invalid_range"), save })
    expect(range).toMatchObject({ ok: false, error: { state: "error" } })
    const offline = await downloadMyCalendar({ from: "2026-11-16", to: "2026-12-13" }, { get: async () => { throw new TypeError("Failed to fetch") }, save })
    expect(offline).toMatchObject({ ok: false, error: { state: "network" } })
    const notCal = await downloadMyCalendar({ from: "2026-11-16", to: "2026-12-13" }, { get: async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), save })
    expect(notCal.ok).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})
