import { describe, expect, test } from "vitest"
import { LOG_REDACT_PATHS, makeLogger, scrub } from "./logger"

const capture = () => {
  const lines: string[] = []
  const logger = makeLogger({ level: "debug", destination: { write: (s: string) => void lines.push(s) } })
  return { logger, lines, last: () => JSON.parse(lines[lines.length - 1]) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const R = "[redacted]"

describe("log redaction", () => {
  test("authorization, cookie, set-cookie, password, token, secret and code fields are redacted in a logged object", () => {
    const { logger, last, lines } = capture()
    logger.info({ authorization: "Bearer abc.def.ghi", cookie: "sid=1", "set-cookie": ["sid=2; HttpOnly"], password: "hunter2!", token: "tok_123", secret: "s3cr3t", code: "123456", ok: "visible" }, "x")
    expect(last()).toMatchObject({ authorization: R, cookie: R, "set-cookie": R, password: R, token: R, secret: R, code: R, ok: "visible" })
    for (const v of ["abc.def.ghi", "sid=1", "sid=2", "hunter2", "tok_123", "s3cr3t", "123456"]) expect(lines.join("")).not.toContain(v)
  })

  test("hostile shapes: nested, arrays, case variants, compound names, otp and api keys", () => {
    const { logger, lines } = capture()
    logger.info(
      {
        req: { headers: { Authorization: "Bearer HOSTILE1", COOKIE: "HOSTILE2", "Set-Cookie": ["HOSTILE3"], "X-Api-Key": "HOSTILE4" } },
        deep: { a: { b: { c: { d: [{ newPassword: "HOSTILE5", accessToken: "HOSTILE6", refresh_token: "HOSTILE7", webhookSecret: "HOSTILE8", totpCode: "HOSTILE9", otp: "HOSTILE10", enrolmentCode: "HOSTILE11", clientSecret: "HOSTILE12" }] } } } },
        list: [{ token: "HOSTILE13" }, "plain"],
      },
      "hostile",
    )
    expect(lines.join("")).not.toMatch(/HOSTILE\d/)
    expect(lines.join("")).toContain("plain")
  })

  test("secrets inside string values: bearer tokens, api keys, signing secrets and email local parts", () => {
    const { logger, last } = capture()
    logger.info({ note: "sent Authorization: Bearer aaa.bbb.ccc to ann.smith@example.ie with odk_AbCdEf123456 and whsec_Zm9yX2tL and sk_live_51Hxyz" }, "m")
    const note = last().note as string
    expect(note).not.toMatch(/aaa\.bbb|AbCdEf123456|Zm9yX2tL|51Hxyz|ann\.smith/)
    expect(note).toContain("@example.ie") // the domain stays useful, the local part goes
  })

  test("the email key is masked to its first letter; a machine code and a SQLSTATE under `code` are kept, a numeric one-time code is not", () => {
    const { logger, last } = capture()
    logger.info({ email: "jane.doe@example.ie", to: "x@y.ie", code: "23505", other: { code: "queue_timeout" } }, "m")
    expect(last().email).toBe("j***@example.ie")
    expect(last().code).toBe("23505")
    expect(last().other.code).toBe("queue_timeout")
    logger.info({ code: "654321", inner: { code: "12345678" } }, "m")
    expect(last().code).toBe(R)
    expect(last().inner.code).toBe(R)
  })

  test("an Error is logged as its class name and a safe code only, never its message, stack or cause detail", () => {
    const { logger, lines } = capture()
    logger.error({ err: Object.assign(new Error("Failed query: insert into user values ($1) params: leak@example.com"), { cause: { code: "23505", detail: "Key (email)=(leak@example.com)" } }) }, "boom")
    const out = lines.join("")
    expect(out).toContain("23505")
    expect(out).not.toMatch(/Failed query|leak@|Key \(email\)|stack/)
  })

  test("a circular object, a 60-level object, a throwing getter and a Buffer never throw and never leak", () => {
    const { logger, lines } = capture()
    const loop: Record<string, unknown> = { password: "LOOPSECRET" }
    loop.self = loop
    let deep: Record<string, unknown> = { token: "DEEPSECRET" }
    for (let i = 0; i < 60; i++) deep = { next: deep }
    const evil = Object.defineProperty({}, "boom", { enumerable: true, get() { throw new Error("getter") } })
    expect(() => logger.info({ loop, deep, evil, buf: Buffer.from("BUFSECRET") }, "hostile")).not.toThrow()
    const out = lines.join("")
    expect(out).not.toMatch(/LOOPSECRET|DEEPSECRET|BUFSECRET/)
    expect(JSON.parse(lines[0])).toBeTruthy() // still one valid JSON line
  })

  test("the caller's object is not mutated", () => {
    const { logger } = capture()
    const o = { password: "keep-me", nested: { token: "keep-me-too" } }
    logger.info(o, "m")
    expect(o).toEqual({ password: "keep-me", nested: { token: "keep-me-too" } })
  })

  test("the one exported path list is also given to pino itself (defence in depth for the known shapes)", () => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining(["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "password", "token"]))
    expect(scrub({ a: 1 })).toEqual({ a: 1 })
  })

  test("request bodies are never a logged field: a `body` object is dropped", () => {
    const { logger, last } = capture()
    logger.info({ body: { anything: "SECRET-IN-BODY" }, reqBody: "x" }, "m")
    expect(JSON.stringify(last())).not.toContain("SECRET-IN-BODY")
  })
})
