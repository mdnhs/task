import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { makeBrowserClient } from "./browser"
import { onBillingBlocked } from "./blocked"
import { makeActionRunner } from "./action"
import { ApiError } from "./problem"

const problemRes = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r9" }), { status, headers: { "content-type": "application/problem+json" } })

describe("T6.4 a write that still gets 402 shows the banner and rolls back", () => {
  let off: () => void
  const seen = vi.fn()
  beforeEach(() => {
    seen.mockReset()
    off = onBillingBlocked(seen)
  })
  afterEach(() => off())

  test("the browser client announces a 402 billing_required once per response, whatever the call", async () => {
    const f = vi.fn(async () => problemRes(402, "billing_required"))
    const api = makeBrowserClient({ fetch: f as never }) as unknown as { post(p: string, o?: unknown): Promise<unknown> }
    await api.post("/v1/tasks", { body: {} }).catch(() => undefined)
    await api.post("/v1/tasks", { body: {} }).catch(() => undefined)
    expect(seen).toHaveBeenCalledTimes(2)
  })

  test("other refusals (403, 409, 422) never light the banner; a successful write neither", async () => {
    for (const [s, c] of [[403, "forbidden"], [403, "module_not_entitled"], [409, "version_conflict"], [422, "x"]] as const) {
      const api = makeBrowserClient({ fetch: (async () => problemRes(s, c)) as never }) as unknown as { post(p: string, o?: unknown): Promise<unknown> }
      await api.post("/v1/tasks", { body: {} }).catch(() => undefined)
    }
    const ok = makeBrowserClient({ fetch: (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as never }) as unknown as { post(p: string, o?: unknown): Promise<unknown> }
    await ok.post("/v1/tasks", { body: {} })
    expect(seen).not.toHaveBeenCalled()
  })

  test("the runner reverts the optimistic change, shows the mapped copy with a Ref, and re-reads the server (the server is the truth)", async () => {
    const order: string[] = []
    const run = makeActionRunner({ notify: (m) => order.push(`notify:${m.text}|${m.ref}`), refresh: () => order.push("refresh") })
    const r = await run("task-1:status", async () => { throw new ApiError(402, "billing_required", "req-402") }, { rollback: () => order.push("rollback") })
    expect(r).toEqual({ ok: false, kind: "billing_required" })
    expect(order).toEqual(["rollback", "notify:Billing needs attention. Read-only for now.|req-402", "refresh"])
  })

  test("it reverts and refreshes on every kind of refusal, and on success it only refreshes", async () => {
    for (const [status, code] of [[403, "forbidden"], [409, "version_conflict"], [422, "evidence_not_ready"], [500, "boom"]] as const) {
      const rollback = vi.fn()
      const refresh = vi.fn()
      const run = makeActionRunner({ notify: () => undefined, refresh })
      const r = await run(`k${status}`, async () => { throw new ApiError(status, code, "") }, { rollback })
      expect(r.ok, `${status}`).toBe(false)
      expect(rollback, `${status}`).toHaveBeenCalledOnce()
      expect(refresh, `${status}`).toHaveBeenCalledOnce()
    }
    const rollback = vi.fn()
    const refresh = vi.fn()
    const r = await makeActionRunner({ notify: () => undefined, refresh })("ok", async () => 42, { rollback })
    expect(r).toEqual({ ok: true, value: 42 })
    expect(rollback).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  })

  test("a network failure reverts too and is shown as a connection problem", async () => {
    const notify = vi.fn()
    const rollback = vi.fn()
    const r = await makeActionRunner({ notify, refresh: () => undefined })("n", async () => { throw new TypeError("fetch failed") }, { rollback })
    expect(r).toEqual({ ok: false, kind: "network" })
    expect(rollback).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith({ text: "No connection. Try again.", ref: null })
  })

  test("one request per action: a second click with the same key while it is in flight sends nothing", async () => {
    const request = vi.fn(() => new Promise<string>((res) => setTimeout(() => res("done"), 5)))
    const run = makeActionRunner({ notify: () => undefined, refresh: () => undefined })
    const [a, b] = await Promise.all([run("same", request), run("same", request)])
    expect(request).toHaveBeenCalledTimes(1)
    expect([a, b]).toEqual([{ ok: true, value: "done" }, { ok: false, kind: "in_flight" }])
    expect(await run("same", async () => "again")).toEqual({ ok: true, value: "again" }) // free again afterwards
  })
})
