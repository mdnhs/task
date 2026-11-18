import { expect, test } from "vitest"
import { parseEnv } from "./env"

const base = { DATABASE_URL: "postgres://a", DATABASE_OWNER_URL: "postgres://o", REDIS_URL: "redis://r",
  BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000", DATA_REGION: "eu-west-1" }

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
const key32 = Buffer.alloc(32, 7).toString("base64")
test("SECRETS_KEY must be base64 of exactly 32 bytes, and is required in production", () => {
  expect(parseEnv({ ...base, SECRETS_KEY: key32 }).SECRETS_KEY).toBe(key32)
  expect(() => parseEnv({ ...base, SECRETS_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/SECRETS_KEY/)
  expect(() => parseEnv({ ...base, SECRETS_KEY: "not base64 !!" })).toThrow(/SECRETS_KEY/)
  expect(parseEnv({ ...base, NODE_ENV: "development" }).SECRETS_KEY).toBeUndefined()
  expect(() => parseEnv({ ...base, ...prodFiles, NODE_ENV: "production" })).toThrow(/SECRETS_KEY/)
  expect(parseEnv({ ...base, ...prodFiles, NODE_ENV: "production", SECRETS_KEY: key32 }).NODE_ENV).toBe("production")
})
test("RESEND_API_KEY and MAIL_FROM: empty string is unset", () => {
  const env = parseEnv({ ...base, RESEND_API_KEY: "", MAIL_FROM: "" })
  expect(env.RESEND_API_KEY).toBeUndefined()
  expect(env.MAIL_FROM).toBeUndefined()
  expect(parseEnv({ ...base, RESEND_API_KEY: "re_x", MAIL_FROM: "a@x.ie" }).MAIL_FROM).toBe("a@x.ie")
})
test("SECRETS_KEYS keyring: every key 32 bytes, SECRETS_KEY_ID must exist, satisfies production", () => {
  const k = (n: number) => Buffer.alloc(n, 3).toString("base64")
  const keys = JSON.stringify({ k1: k(32), k2: k(32) })
  expect(parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "k2" }).SECRETS_KEY_ID).toBe("k2")
  expect(parseEnv({ ...base, ...prodFiles, NODE_ENV: "production", SECRETS_KEYS: keys, SECRETS_KEY_ID: "k1" }).NODE_ENV).toBe("production")
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "k3" })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: JSON.stringify({ k1: k(16) }), SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEYS/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: "{nope", SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEYS/)
  expect(() => parseEnv({ ...base, SECRETS_KEY_ID: "k1" })).toThrow(/SECRETS_KEY_ID/)
  expect(() => parseEnv({ ...base, SECRETS_KEYS: keys, SECRETS_KEY_ID: "constructor" })).toThrow(/SECRETS_KEY_ID/)
})

const prodBase = { ...base, NODE_ENV: "production", SECRETS_KEY: Buffer.alloc(32, 1).toString("base64") }
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
  expect(parseEnv({ ...prodBase, ...prodFiles }).CLAMD_HOST).toBe("clamd")
  for (const k of Object.keys(prodFiles)) {
    expect(() => parseEnv({ ...prodBase, ...prodFiles, [k]: "" }), k).toThrow(new RegExp(k))
  }
})

test("TRUST_PROXY_HOPS defaults to 1 in production and 0 elsewhere, and is validated", () => {
  expect(parseEnv(base).TRUST_PROXY_HOPS).toBe(0)
  expect(parseEnv({ ...base, NODE_ENV: "test" }).TRUST_PROXY_HOPS).toBe(0)
  expect(parseEnv({ ...base, NODE_ENV: "production", ...prodFiles, SECRETS_KEY: Buffer.alloc(32, 1).toString("base64") }).TRUST_PROXY_HOPS).toBe(1)
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
  const prod = { ...base, NODE_ENV: "production", ...prodFiles, SECRETS_KEY: Buffer.alloc(32, 1).toString("base64") }
  expect(parseEnv({ ...prod, AUTH_RATE_LIMIT_PER_MIN: "300" }).AUTH_RATE_LIMIT_PER_MIN).toBe(300)
  expect(() => parseEnv({ ...prod, AUTH_RATE_LIMIT_PER_MIN: "301" })).toThrow(/AUTH_RATE_LIMIT_PER_MIN/)
  expect(parseEnv({ ...base, AUTH_RATE_LIMIT_PER_MIN: "1000" }).AUTH_RATE_LIMIT_PER_MIN).toBe(1000) // the e2e stack (development)
})
