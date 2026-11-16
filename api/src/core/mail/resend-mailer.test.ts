import { beforeEach, expect, test, vi } from "vitest"
import { sanitizeMailError } from "./sanitize"

const h = vi.hoisted(() => ({ send: vi.fn(), ctor: vi.fn() }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send }
    constructor(key: string) { h.ctor(key) }
  },
}))

import { ConsoleMailer } from "./console-mailer"
import { ResendMailer, type MailConfigSource } from "./resend-mailer"

const msg = { to: "u@x.ie", subject: "Hi", text: "secret body" }
const fallback = { send: vi.fn(async () => undefined) }
beforeEach(() => { h.send.mockReset(); h.ctor.mockReset(); fallback.send.mockClear(); h.send.mockResolvedValue({ data: { id: "1" }, error: null }) })

test('ResendMailer sends via the SDK with configured from "Name <address>"', async () => {
  const source: MailConfigSource = { get: async () => ({ apiKey: "re_test_key_0000000000", from: "OpsDesk <no-reply@x.ie>" }) }
  await new ResendMailer({ source, fallback }).send(msg)
  expect(h.ctor).toHaveBeenCalledWith("re_test_key_0000000000")
  expect(h.send).toHaveBeenCalledWith({ from: "OpsDesk <no-reply@x.ie>", to: "u@x.ie", subject: "Hi", text: "secret body" })
  expect(fallback.send).not.toHaveBeenCalled()
})
test("ResendMailer picks up new settings after invalidate(), and caches for at most 60 s", async () => {
  let cfg = { apiKey: "re_old_key_00000000000", from: "A <a@x.ie>" }
  const get = vi.fn(async () => cfg)
  let t = 0
  const m = new ResendMailer({ source: { get }, fallback, now: () => t })
  await m.send(msg)
  cfg = { apiKey: "re_new_key_00000000000", from: "B <b@x.ie>" }
  await m.send(msg)
  expect(get).toHaveBeenCalledTimes(1) // cached
  expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: "A <a@x.ie>" }))
  m.invalidate()
  await m.send(msg)
  expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: "B <b@x.ie>" }))
  expect(h.ctor).toHaveBeenLastCalledWith("re_new_key_00000000000")
  cfg = { apiKey: "re_third_key_0000000000", from: "C <c@x.ie>" }
  t = 61_000
  await m.send(msg)
  expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: "C <c@x.ie>" }))
})
test("ResendMailer uses the fallback when nothing is configured", async () => {
  await new ResendMailer({ source: { get: async () => null }, fallback }).send(msg)
  expect(fallback.send).toHaveBeenCalledWith(msg)
  expect(h.send).not.toHaveBeenCalled()
})
test("ResendMailer throws on an SDK error response", async () => {
  h.send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad from", statusCode: 422 } })
  const m = new ResendMailer({ source: { get: async () => ({ apiKey: "re_k_0000000000000000", from: "A <a@x.ie>" }) }, fallback })
  await expect(m.send(msg)).rejects.toThrow(/validation_error/)
})
test("ConsoleMailer logs only to + subject, never the body", async () => {
  const lines: Record<string, unknown>[] = []
  const logger = { info: (o: Record<string, unknown>, m: string) => lines.push({ ...o, m }) }
  await new ConsoleMailer(logger as never).send(msg)
  expect(lines).toEqual([{ to: "u@x.ie", subject: "Hi", m: "mail suppressed" }])
})
test("sanitizeMailError strips keys and token urls and truncates", () => {
  const e = Object.assign(new Error("failed with re_abcDEF123_456 at https://x.ie/verify-email?token=abc.def&x=1 ok"), { code: "E_FAIL" })
  const s = sanitizeMailError(e)
  expect(s).toContain("Error E_FAIL")
  expect(s).not.toMatch(/re_abc|token=|abc\.def/)
  expect(sanitizeMailError(new Error("x".repeat(500))).length).toBeLessThanOrEqual(230)
  expect(sanitizeMailError("plain string re_zzzzzzzzzz")).not.toContain("re_zzz")
})
