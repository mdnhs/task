import { randomBytes } from "node:crypto"
import pino from "pino"
import { beforeEach, expect, test, vi } from "vitest"
import { resetDb, testApp, testEnv } from "../../../test/harness"
import { testDb } from "../../../test/db"
import { signUp } from "../../../test/factories"

const h = vi.hoisted(() => ({ send: vi.fn(), ctor: vi.fn() }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send }
    constructor(key: string) { h.ctor(key) }
  },
}))

import { InMemoryAuditSink, makeMailer, setEmailSettings } from "./index"

const SECRETS_KEY = randomBytes(32).toString("base64")
const msg = { to: "u@x.ie", subject: "Hi", text: "body" }
const silent = pino({ level: "silent" })
beforeEach(async () => { await resetDb(); h.send.mockReset(); h.ctor.mockReset(); h.send.mockResolvedValue({ data: { id: "1" }, error: null }) })

test("DB settings win over env bootstrap, and setEmailSettings invalidates the cache", async () => {
  const env = { ...testEnv, SECRETS_KEY, RESEND_API_KEY: "re_env_key_000000000000", MAIL_FROM: "Env <env@x.ie>" }
  const mailer = makeMailer({ env, db: testDb(), logger: silent })
  await mailer.send(msg) // env bootstrap only so far
  expect(h.ctor).toHaveBeenLastCalledWith("re_env_key_000000000000")
  expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: "Env <env@x.ie>" }))
  await setEmailSettings(testDb(), { env, clock: { now: () => new Date() }, mailer, audit: new InMemoryAuditSink() },
    { apiKey: "re_db_key_0000000000000", fromAddress: "db@x.ie", fromName: "Db" }, "admin")
  await mailer.send(msg)
  expect(h.ctor).toHaveBeenLastCalledWith("re_db_key_0000000000000")
  expect(h.send).toHaveBeenLastCalledWith(expect.objectContaining({ from: "Db <db@x.ie>" }))
})
test("dev/test with nothing configured uses the console mailer (no SDK call)", async () => {
  await makeMailer({ env: testEnv, db: testDb(), logger: silent }).send(msg)
  expect(h.send).not.toHaveBeenCalled()
})
test("production with no settings and no env key -> FailingMailer; sign-up still 200 and error logged", async () => {
  const env = { ...testEnv, NODE_ENV: "production" as const, SECRETS_KEY }
  const lines: string[] = []
  const logger = pino({ level: "error" }, { write: (l: string) => void lines.push(l) })
  const mailer = makeMailer({ env, db: testDb(), logger })
  await expect(mailer.send(msg)).rejects.toThrow(/email not configured/)
  const { app } = testApp({ env, mailer, logger })
  const r = await signUp(app, "p@x.ie", "Passw0rd!long", "P", { verify: false })
  expect(r.status).toBe(200)
  await new Promise((res) => setTimeout(res, 30))
  expect(lines.some((l) => l.includes("verification email send failed") && l.includes("email not configured"))).toBe(true)
  expect(lines.join("")).not.toMatch(/token=/)
})
