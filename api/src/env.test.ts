import { expect, test } from "vitest"
import { parseEnv } from "./env"

const base = { DATABASE_URL: "postgres://a", DATABASE_OWNER_URL: "postgres://o", REDIS_URL: "redis://r",
  BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000", DATA_REGION: "eu-west-1" }

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
