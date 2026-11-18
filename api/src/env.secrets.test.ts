import { expect, test } from "vitest"
import { call, testApp, testEnv } from "../test/harness"
import { makeLogErrorReporter } from "./core/observability/error-reporter"
import { makeLogger, secretValuesOf } from "./core/observability/logger"
import { errorInfo } from "./core/safe-error"
import { parseEnv } from "./env"

// B7 Task 18: the two deploy secrets must not leave the process through an error, a log line or a 500 body, even when a careless caller puts them in the message.
const SECRETS_KEY = Buffer.alloc(32, 9).toString("base64")
const BETTER_AUTH_SECRET = "PLANTED-auth-secret-0123456789-abcdefghij"

test("a thrown error and a logged object never contain SECRETS_KEY or BETTER_AUTH_SECRET values", async () => {
  const lines: string[] = []
  const env = { ...testEnv, SECRETS_KEY, BETTER_AUTH_SECRET }
  const logger = makeLogger({ level: "debug", destination: { write: (s: string) => void lines.push(s) }, secretValues: secretValuesOf(env) }) // exactly how server.ts builds it
  const { app } = testApp({ env, logger, errorReporter: makeLogErrorReporter(logger) })
  // A handler that fails with both values in its message and a cause, and one that logs the whole env object.
  app.get("/v1/_leak500", () => { throw Object.assign(new Error(`bad key ${SECRETS_KEY} / ${BETTER_AUTH_SECRET}`), { cause: { code: "XX000", detail: SECRETS_KEY } }) })
  app.get("/v1/_leaklog", (c) => {
    logger.info({ env, SECRETS_KEY, BETTER_AUTH_SECRET, nested: { secret: BETTER_AUTH_SECRET, note: `value ${SECRETS_KEY}` } }, `startup ${BETTER_AUTH_SECRET}`)
    logger.error({ ...errorInfo(new Error(SECRETS_KEY)) }, "failed")
    return c.json({ ok: true })
  })
  const r500 = await call(app, "GET", "/v1/_leak500")
  expect(r500.status).toBe(500)
  const body = await r500.text()
  await call(app, "GET", "/v1/_leaklog")
  const out = lines.join("")
  for (const v of [SECRETS_KEY, BETTER_AUTH_SECRET]) {
    expect(body).not.toContain(v)
    expect(out).not.toContain(v)
  }
  expect(out.length).toBeGreaterThan(0) // the capture saw the lines: the absence above is real
})

test("a parseEnv failure message names the variable and never carries a secret value", () => {
  const bad = { DATABASE_URL: "postgres://app_user:DBPASSWORD99@db/x", DATABASE_OWNER_URL: "postgres://app_owner:OWNERPW88@db/x", REDIS_URL: "redis://:REDISPW77@r", BETTER_AUTH_SECRET: "tooshort-AUTHSECRET66", APP_URL: "http://localhost", DATA_REGION: "eu-west-1", SECRETS_KEY: "SECRETSKEY55-not-base64!" }
  let msg = ""
  try { parseEnv(bad) } catch (e) { msg = (e as Error).message }
  expect(msg).toMatch(/BETTER_AUTH_SECRET/)
  expect(msg).toMatch(/SECRETS_KEY/)
  expect(msg).not.toMatch(/DBPASSWORD99|OWNERPW88|REDISPW77|AUTHSECRET66|SECRETSKEY55/)
})
