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

describe("T6.5 a refusal the caller shows itself (a form field) is not toasted", () => {
  test("handled() returning true skips the toast but still rolls back and refreshes; false keeps the toast", async () => {
    const notify = vi.fn()
    const refresh = vi.fn()
    const run = makeActionRunner({ notify, refresh })
    const rollback = vi.fn()
    const r1 = await run("a", async () => { throw new ApiError(422, "invalid_color", "r1") }, { rollback, handled: () => true })
    expect(r1.ok).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await run("b", async () => { throw new ApiError(500, "boom", "r2") }, { handled: () => false })
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe("T6.6 a write refused with 409 retry is repeated ONCE, identically", () => {
  const mk = () => {
    const notify = vi.fn()
    const refresh = vi.fn()
    return { notify, refresh, run: makeActionRunner({ notify, refresh }) }
  }
  test("the second answer wins: one repeat, no toast", async () => {
    const { run, notify } = mk()
    const request = vi.fn().mockRejectedValueOnce(new ApiError(409, "retry", "r1")).mockResolvedValueOnce("ok")
    const r = await run("k", request)
    expect(r).toEqual({ ok: true, value: "ok" })
    expect(request).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
  })
  test("a second retry is not repeated again: it is shown and rolled back", async () => {
    const { run, notify } = mk()
    const rollback = vi.fn()
    const request = vi.fn().mockRejectedValue(new ApiError(409, "retry", "r1"))
    const r = await run("k", request, { rollback })
    expect(r).toEqual({ ok: false, kind: "retry" })
    expect(request).toHaveBeenCalledTimes(2)
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ text: "Busy. Please try again.", ref: "r1" })
  })
  test("no other refusal is repeated (version_conflict, 403, 500)", async () => {
    for (const e of [new ApiError(409, "version_conflict", "r1"), new ApiError(403, "forbidden", "r1"), new ApiError(500, "boom", "r1")]) {
      const { run } = mk()
      const request = vi.fn().mockRejectedValue(e)
      await run("k", request)
      expect(request).toHaveBeenCalledTimes(1)
    }
  })
  test("a failed request can be retried by the user: the in-flight guard is released", async () => {
    const { run } = mk()
    const request = vi.fn().mockRejectedValueOnce(new ApiError(403, "forbidden", "r1")).mockResolvedValueOnce("fine")
    expect((await run("k", request)).ok).toBe(false)
    expect(await run("k", request)).toEqual({ ok: true, value: "fine" })
  })
  test("a double click sends one request", async () => {
    const { run } = mk()
    let release: (v: string) => void = () => {}
    const request = vi.fn(() => new Promise<string>((r) => (release = r)))
    const a = run("complete", request)
    const b = await run("complete", request)
    expect(b).toEqual({ ok: false, kind: "in_flight" })
    release("x")
    await a
    expect(request).toHaveBeenCalledTimes(1)
  })
})
