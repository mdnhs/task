import { describe, expect, test } from "vitest"
import { parseEnv } from "./env"

const base = { DATABASE_URL: "postgres://app_user@db/x", DATABASE_OWNER_URL: "postgres://app_owner@db/x", REDIS_URL: "redis://r",
  BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000", DATA_REGION: "eu-west-1" }
// What production must look like (B7 Task 18): a strong secret, an https origin, two different database roles, the clamd host and the stored-secret key.
const spread = (n: number) => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + n) % 251)).toString("base64") // 32 bytes with many distinct values
const STRONG = "k9Qv3Zr8Lm2Xw7Bn4Tc6Yh1Jd5Gf0Sa-Pe"
const prodOk = { ...base, NODE_ENV: "production", APP_URL: "https://app.example.com", BETTER_AUTH_SECRET: STRONG, CLAMD_HOST: "clamd", SECRETS_KEY: spread(1) }

const prodFiles = { CLAMD_HOST: "clamd" }

test("parseEnv rejects missing DATABASE_URL", () => {
  const { DATABASE_URL: _omit, ...rest } = base
  expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/)
})
test("parseEnv defaults PORT to 8787 and NODE_ENV to development", () => {
  expect(parseEnv(base)).toMatchObject({ PORT: 8787, NODE_ENV: "development" })
})
test("parseEnv rejects a non-EU DATA_REGION", () => {
  expect(() => parseEnv({ ...base, DATA_REGION: "us-east-1" })).toThrow(/DATA_REGION/)
})
test("parseEnv rejects BETTER_AUTH_SECRET shorter than 32 chars", () => {
  expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/)
})
test("parseEnv treats empty-string OAuth vars as unset", () => {
  const env = parseEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", MICROSOFT_CLIENT_ID: "", MICROSOFT_CLIENT_SECRET: "" })
  expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
  expect(env.MICROSOFT_CLIENT_SECRET).toBeUndefined()
})
test("parseEnv keeps real OAuth values", () => {
  expect(parseEnv({ ...base, GOOGLE_CLIENT_ID: "g" }).GOOGLE_CLIENT_ID).toBe("g")
})
test("parseEnv accepts PORT 1..65535 and rejects everything else", () => {
  expect(parseEnv({ ...base, PORT: "8080" }).PORT).toBe(8080)
  expect(parseEnv({ ...base, PORT: "65535" }).PORT).toBe(65535)
  for (const bad of ["0", "-1", "65536", "80.5", "abc", ""]) {
    expect(() => parseEnv({ ...base, PORT: bad }), `PORT=${bad}`).toThrow(/PORT/)
  }
})
const key32 = spread(7)
test("SECRETS_KEY must be base64 of exactly 32 bytes, and is required in production", () => {
  expect(parseEnv({ ...base, SECRETS_KEY: key32 }).SECRETS_KEY).toBe(key32)
  expect(() => parseEnv({ ...base, SECRETS_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/SECRETS_KEY/)
  expect(() => parseEnv({ ...base, SECRETS_KEY: "not base64 !!" })).toThrow(/SECRETS_KEY/)
  expect(parseEnv({ ...base, NODE_ENV: "development" }).SECRETS_KEY).toBeUndefined()
  expect(() => parseEnv({ ...prodOk, SECRETS_KEY: undefined })).toThrow(/SECRETS_KEY/)
  expect(parseEnv({ ...prodOk, SECRETS_KEY: key32 }).NODE_ENV).toBe("production")
})
test("RESEND_API_KEY and MAIL_FROM: empty string is unset", () => {
  const env = parseEnv({ ...base, RESEND_API_KEY: "", MAIL_FROM: "" })
  expect(env.RESEND_API_KEY).toBeUndefined()
  expect(env.MAIL_FROM).toBeUndefined()
  expect(parseEnv({ ...base, RESEND_API_KEY: "re_x", MAIL_FROM: "a@x.ie" }).MAIL_FROM).toBe("a@x.ie")
})
test("SECRETS_KEYS keyring: every key 32 bytes, SECRETS_KEY_ID must exist, satisfies production", () => {
  const k = (n: number) => (n === 32 ? spread(3) : Buffer.alloc(n, 3).toString("base64"))
  const keys = JSON.stringify({ k1: k(32), k2: k(32) })
  expect(parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "k2" }).SECRETS_KEY_ID).toBe("k2")
  expect(parseEnv({ ...prodOk, SECRETS_KEY: undefined, SECRETS_KEYS: keys, SECRETS_KEY_ID: "k1" }).NODE_ENV).toBe("production")
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "k3" })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: JSON.stringify({ k1: k(16) }), SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEYS/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: "{nope", SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEYS/)
  expect(() => parseEnv({ ...base, SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "constructor" })).toThrow(/SECRETS_KEY_ID/)
})

const prodBase = { ...prodOk }
test("file env: defaults, empty strings are unset, bool and number parsing", () => {
  const e = parseEnv({ ...base, S3_ENDPOINT: "", S3_FORCE_PATH_STYLE: "", CLAMD_PORT: "", FILE_MAX_BYTES: "" })
  expect(e).toMatchObject({ FILE_MAX_BYTES: 26214400, CLAMD_PORT: 3310, S3_FORCE_PATH_STYLE: false })
  expect(e.S3_ENDPOINT).toBeUndefined()
  expect(parseEnv({ ...base, S3_FORCE_PATH_STYLE: "true", CLAMD_PORT: "3311", FILE_MAX_BYTES: "1000" })).toMatchObject({ S3_FORCE_PATH_STYLE: true, CLAMD_PORT: 3311, FILE_MAX_BYTES: 1000 })
  expect(() => parseEnv({ ...base, FILE_MAX_BYTES: "0" })).toThrow(/FILE_MAX_BYTES/)
  expect(() => parseEnv({ ...base, S3_FORCE_PATH_STYLE: "maybe" })).toThrow(/S3_FORCE_PATH_STYLE/)
  expect(() => parseEnv({ ...base, CLAMD_PORT: "70000" })).toThrow(/CLAMD_PORT/)
})
test("file env: production requires the clamd host; S3_* are optional (R2 settings live in the DB)", () => {
  expect(parseEnv(prodBase).CLAMD_HOST).toBe("clamd")
  for (const k of Object.keys(prodFiles)) {
    expect(() => parseEnv({ ...prodBase, [k]: "" }), k).toThrow(new RegExp(k))
  }
})

test("TRUST_PROXY_HOPS defaults to 1 in production and 0 elsewhere, and is validated", () => {
  expect(parseEnv(base).TRUST_PROXY_HOPS).toBe(0)
  expect(parseEnv({ ...base, NODE_ENV: "test" }).TRUST_PROXY_HOPS).toBe(0)
  expect(parseEnv(prodOk).TRUST_PROXY_HOPS).toBe(1)
  expect(parseEnv({ ...base, TRUST_PROXY_HOPS: "2" }).TRUST_PROXY_HOPS).toBe(2)
  expect(parseEnv({ ...base, TRUST_PROXY_HOPS: "" }).TRUST_PROXY_HOPS).toBe(0)
  expect(() => parseEnv({ ...base, TRUST_PROXY_HOPS: "-1" })).toThrow(/TRUST_PROXY_HOPS/)
  expect(() => parseEnv({ ...base, TRUST_PROXY_HOPS: "x" })).toThrow(/TRUST_PROXY_HOPS/)
})
test("AUTH_RATE_LIMIT_PER_MIN defaults to 30 and must be a positive integer", () => {
  expect(parseEnv(base).AUTH_RATE_LIMIT_PER_MIN).toBe(30)
  expect(parseEnv({ ...base, AUTH_RATE_LIMIT_PER_MIN: "600" }).AUTH_RATE_LIMIT_PER_MIN).toBe(600)
  expect(() => parseEnv({ ...base, AUTH_RATE_LIMIT_PER_MIN: "0" })).toThrow(/AUTH_RATE_LIMIT_PER_MIN/)
})
test("AUTH_RATE_LIMIT_PER_MIN is capped at 300 in production only", () => {
  const prod = prodOk
  expect(parseEnv({ ...prod, AUTH_RATE_LIMIT_PER_MIN: "300" }).AUTH_RATE_LIMIT_PER_MIN).toBe(300)
  expect(() => parseEnv({ ...prod, AUTH_RATE_LIMIT_PER_MIN: "301" })).toThrow(/AUTH_RATE_LIMIT_PER_MIN/)
  expect(parseEnv({ ...base, AUTH_RATE_LIMIT_PER_MIN: "1000" }).AUTH_RATE_LIMIT_PER_MIN).toBe(1000) // the e2e stack (development)
})
test("metrics are off by default, loopback by default, and never on the public port", () => {
  const e = parseEnv(base)
  expect(e.METRICS_PORT).toBeUndefined()
  expect(e.WORKER_METRICS_PORT).toBeUndefined()
  expect(e.METRICS_HOST).toBe("127.0.0.1")
  expect(e.LOG_LEVEL).toBe("info")
  expect(parseEnv({ ...base, METRICS_PORT: "", METRICS_HOST: "" }).METRICS_PORT).toBeUndefined()
  expect(parseEnv({ ...base, METRICS_PORT: "9464", WORKER_METRICS_PORT: "9465" })).toMatchObject({ METRICS_PORT: 9464, WORKER_METRICS_PORT: 9465 })
  expect(() => parseEnv({ ...base, PORT: "9464", METRICS_PORT: "9464" })).toThrow(/METRICS_PORT/)
  expect(() => parseEnv({ ...base, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/)
})

describe("production refuses insecure settings (B7 Task 18)", () => {
  test("a fully set production env boots", () => {
    expect(parseEnv(prodOk).NODE_ENV).toBe("production")
  })
  test("production env refuses a weak or example BETTER_AUTH_SECRET", () => {
    for (const bad of ["x".repeat(32), "a".repeat(40), "changeme".repeat(5), "test-secret-test-secret-test-secret-1234", "load-secret-load-secret-load-secret-load-secret", "your-secret-key-here-your-secret-key-here", "replace-with-a-long-random-string-0000", "0123456789012345678901234567890123456789", "password".repeat(5), "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME"]) {
      expect(() => parseEnv({ ...prodOk, BETTER_AUTH_SECRET: bad }), bad).toThrow(/BETTER_AUTH_SECRET/)
    }
    expect(() => parseEnv({ ...prodOk, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/)
    expect(parseEnv({ ...prodOk, BETTER_AUTH_SECRET: STRONG }).BETTER_AUTH_SECRET).toBe(STRONG)
  })
  test("a weak BETTER_AUTH_SECRET stays allowed outside production (tests, local, the e2e stack)", () => {
    expect(parseEnv({ ...base, BETTER_AUTH_SECRET: "x".repeat(32) }).NODE_ENV).toBe("development")
  })
  test("production env refuses a non-https APP_URL", () => {
    for (const bad of ["http://app.example.com", "http://localhost:3000", "app.example.com", "ftp://app.example.com"]) {
      expect(() => parseEnv({ ...prodOk, APP_URL: bad }), bad).toThrow(/APP_URL/)
    }
    expect(parseEnv({ ...prodOk, APP_URL: "https://app.example.com" }).APP_URL).toBe("https://app.example.com")
    expect(parseEnv({ ...base, APP_URL: "http://localhost:3000" }).APP_URL).toBe("http://localhost:3000")
  })
  test("production env refuses owner and app database URLs using the same user", () => {
    expect(() => parseEnv({ ...prodOk, DATABASE_URL: "postgres://app_owner:pw@db/x", DATABASE_OWNER_URL: "postgres://app_owner:pw2@db/x" })).toThrow(/DATABASE_OWNER_URL/)
    expect(() => parseEnv({ ...prodOk, DATABASE_URL: "postgres://db/x", DATABASE_OWNER_URL: "postgres://db/y" })).toThrow(/DATABASE_OWNER_URL/)
    expect(parseEnv({ ...prodOk, DATABASE_URL: "postgres://app_user:pw@db/x", DATABASE_OWNER_URL: "postgres://app_owner:pw@db/x" }).NODE_ENV).toBe("production")
    expect(parseEnv({ ...base, DATABASE_URL: "postgres://pg@db/x", DATABASE_OWNER_URL: "postgres://pg@db/x" }).NODE_ENV).toBe("development") // local dev may use one role
  })
  test("DATABASE_OWNER_URL is optional: the API and worker start without it, and a present one is still checked against the app role", () => {
    const noOwner = { ...prodOk, DATABASE_OWNER_URL: undefined }
    expect(parseEnv(noOwner).DATABASE_OWNER_URL).toBeUndefined()
    expect(parseEnv({ ...noOwner, DATABASE_OWNER_URL: "" }).DATABASE_OWNER_URL).toBeUndefined()
    expect(() => parseEnv({ ...prodOk, DATABASE_OWNER_URL: prodOk.DATABASE_URL })).toThrow(/DATABASE_OWNER_URL/)
  })
  test("production env refuses TRUST_PROXY_HOPS=0 without ALLOW_NO_PROXY", () => {
    expect(() => parseEnv({ ...prodOk, TRUST_PROXY_HOPS: "0" })).toThrow(/TRUST_PROXY_HOPS/)
    expect(parseEnv({ ...prodOk, TRUST_PROXY_HOPS: "0", ALLOW_NO_PROXY: "1" }).TRUST_PROXY_HOPS).toBe(0)
    expect(() => parseEnv({ ...prodOk, TRUST_PROXY_HOPS: "0", ALLOW_NO_PROXY: "true" })).toThrow(/TRUST_PROXY_HOPS/)
    expect(parseEnv({ ...prodOk, TRUST_PROXY_HOPS: "2" }).TRUST_PROXY_HOPS).toBe(2)
    expect(parseEnv({ ...base, TRUST_PROXY_HOPS: "0" }).TRUST_PROXY_HOPS).toBe(0)
  })
  test("production env refuses the demo seed switches", () => {
    expect(() => parseEnv({ ...prodOk, ALLOW_DEMO_SEED: "1" })).toThrow(/ALLOW_DEMO_SEED/)
    expect(() => parseEnv({ ...prodOk, SEED_DEMO_PASSWORD: "demo-password-123" })).toThrow(/SEED_DEMO_PASSWORD/)
    expect(parseEnv({ ...prodOk, ALLOW_DEMO_SEED: "" }).NODE_ENV).toBe("production")
    expect(parseEnv({ ...base, ALLOW_DEMO_SEED: "1" }).NODE_ENV).toBe("development")
  })
  test("production env refuses a missing SECRETS_KEY and CLAMD_HOST", () => {
    expect(() => parseEnv({ ...prodOk, SECRETS_KEY: undefined })).toThrow(/SECRETS_KEY/)
    expect(() => parseEnv({ ...prodOk, CLAMD_HOST: undefined })).toThrow(/CLAMD_HOST/)
  })
  test("production refuses a weak SECRETS_KEY and any weak SECRETS_KEYS entry (fewer than 12 distinct byte values)", () => {
    const weak = [Buffer.alloc(32, 0), Buffer.alloc(32, 0xff), Buffer.alloc(32, 65), Buffer.from("abcdefghijabcdefghijabcdefghijab"), Buffer.from(Array.from({ length: 32 }, (_, i) => i % 11))]
    for (const b of weak) {
      const v = b.toString("base64")
      expect(() => parseEnv({ ...prodOk, SECRETS_KEY: v }), v).toThrow(/SECRETS_KEY/)
      expect(() => parseEnv({ ...prodOk, SECRETS_KEY: ` ${v} ` }), "whitespace").toThrow(/SECRETS_KEY/)
      expect(() => parseEnv({ ...prodOk, SECRETS_KEY: undefined, SECRETS_KEYS: JSON.stringify({ k1: spread(2), k2: v }), SECRETS_KEY_ID: "k1" }), "keyring").toThrow(/SECRETS_KEYS/)
    }
    expect(() => parseEnv({ ...prodOk, SECRETS_KEY: "A".repeat(43) + "=" }), "case variant of the zero key (still low variety)").toThrow(/SECRETS_KEY/)
    expect(() => parseEnv({ ...prodOk, SECRETS_KEY: "a".repeat(43) + "=" })).toThrow(/SECRETS_KEY/)
    expect(parseEnv({ ...prodOk, SECRETS_KEY: spread(5) }).NODE_ENV).toBe("production")
    expect(parseEnv({ ...prodOk, SECRETS_KEY: undefined, SECRETS_KEYS: JSON.stringify({ k1: spread(2), k2: spread(9) }), SECRETS_KEY_ID: "k1" }).NODE_ENV).toBe("production")
    // development and test keep accepting a weak key (fixtures)
    expect(parseEnv({ ...base, SECRETS_KEY: Buffer.alloc(32, 7).toString("base64") }).NODE_ENV).toBe("development")
    expect(parseEnv({ ...base, NODE_ENV: "test", SECRETS_KEYS: JSON.stringify({ k1: Buffer.alloc(32, 3).toString("base64") }), SECRETS_KEY_ID: "k1" }).NODE_ENV).toBe("test")
  })
  test("the refusal message names the variable and never prints its value", () => {
    let msg = ""
    try { parseEnv({ ...prodOk, BETTER_AUTH_SECRET: "x".repeat(40), DATABASE_URL: "postgres://app_owner:HUNTER2PW@db/x", DATABASE_OWNER_URL: "postgres://app_owner:HUNTER2PW@db/x" }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/BETTER_AUTH_SECRET/)
    expect(msg).not.toMatch(/HUNTER2PW|xxxxxxxx/)
  })
})
