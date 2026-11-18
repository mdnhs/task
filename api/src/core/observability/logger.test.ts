import { describe, expect, test } from "vitest"
import { LOG_REDACT_PATHS, makeLogger, scrub, secretValuesOf } from "./logger"

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

  test("a hostile __proto__ key is just data: it pollutes nothing, is still scrubbed, and never throws", () => {
    const { logger, lines } = capture()
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes", "password": "PROTOSECRET"}, "constructor": {"token": "CTORSECRET"}, "ok": 1}')
    expect(() => logger.info(hostile, "m")).not.toThrow()
    const out = lines.join("")
    expect(out).not.toMatch(/PROTOSECRET|CTORSECRET/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.hasOwn(scrub(hostile), "__proto__")).toBe(true) // kept as an own data key, not swallowed by the prototype setter
    expect(JSON.parse(lines[0]).ok).toBe(1)
  })

  test("an error with a cause chain logs only the outer class name and code: no inner message, no nested detail", () => {
    const { logger, lines } = capture()
    const inner = Object.assign(new Error("INNERMSG leak@example.com"), { code: "ECONNRESET", detail: "INNERDETAIL" })
    const mid = Object.assign(new Error("MIDMSG", { cause: inner }), { code: "XX000" })
    logger.error({ err: new Error("OUTERMSG", { cause: mid }), nested: { error: new Error("NESTEDMSG", { cause: inner }) } }, "boom")
    expect(lines.join("")).not.toMatch(/INNERMSG|MIDMSG|OUTERMSG|NESTEDMSG|INNERDETAIL|leak@/)
  })

  test("a string over the cap is truncated, not logged whole", () => {
    const { logger, last } = capture()
    logger.info({ blob: "x".repeat(50_000) + "TAILSECRET" }, "m")
    expect((last().blob as string).length).toBeLessThanOrEqual(2000)
    expect(JSON.stringify(last())).not.toContain("TAILSECRET")
  })
})

describe("secret values and error fields (B7 fix wave)", () => {
  const cap = (values: string[]) => {
    const lines: string[] = []
    return { lines, logger: makeLogger({ level: "debug", destination: { write: (s: string) => void lines.push(s) }, secretValues: values }) }
  }

  test("secretValuesOf includes the passwords parsed from DATABASE_URL, DATABASE_OWNER_URL and REDIS_URL", () => {
    const v = secretValuesOf({ DATABASE_URL: "postgres://app_user:Pw%2Fuser9876@db/x", DATABASE_OWNER_URL: "postgres://app_owner:OwnerPw12345@db/x", REDIS_URL: "redis://:RedisPw123456@r:6379", BETTER_AUTH_SECRET: "auth-secret-0123456789" })
    for (const x of ["Pw/user9876", "Pw%2Fuser9876", "OwnerPw12345", "RedisPw123456", "auth-secret-0123456789"]) expect(v, x).toContain(x)
    expect(secretValuesOf({ DATABASE_URL: "postgres://app_user@db/x", REDIS_URL: "not a url" })).toEqual([])
  })

  test("a value bound by logger.child({...}) is masked, and so is a connection password in free text", () => {
    const { logger, lines } = cap(secretValuesOf({ REDIS_URL: "redis://:RedisPw123456@r:6379" }))
    logger.child({ note: "dial redis://:RedisPw123456@r:6379", other: "RedisPw123456" }).info({ a: 1 }, "hello RedisPw123456")
    expect(lines.join("")).not.toContain("RedisPw123456")
    expect(lines.length).toBeGreaterThan(0)
  })

  test("an { err } field is logged as its class name and code, not as NonError", () => {
    const { logger, lines } = cap([])
    logger.error({ err: Object.assign(new TypeError("Failed query with a@b.ie"), { code: "23505" }) }, "failed")
    const o = JSON.parse(lines[0])
    expect(o.err).toEqual({ name: "TypeError", code: "23505" })
    expect(lines[0]).not.toContain("a@b.ie")
    logger.error({ err: "plain string" }, "x")
    expect(JSON.parse(lines[1]).err).toBe("plain string")
  })
})
