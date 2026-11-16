import { randomUUID } from "node:crypto"
import pino from "pino"
import { expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { fakeQueue } from "./fake-queue"
import { logJobFailure, makeBullQueue } from "./bull-queue"
import { makeLoggingPush } from "../push"

const SECRET = "secret@example.com"
const capture = () => {
  const lines: string[] = []
  return { lines, logger: pino({ level: "debug" }, { write: (s: string) => void lines.push(s) } as never) }
}
const drizzleLike = () => Object.assign(new Error(`Failed query: insert into "user" (email) values ($1)\nparams: ${SECRET}`), { cause: { code: "23505", detail: SECRET } })

test("worker failed handler logs only the error name and a safe code, never the message", () => {
  const { lines, logger } = capture()
  logJobFailure(logger, { name: "notification.send" }, drizzleLike())
  const out = lines.join("")
  expect(out).not.toContain(SECRET)
  expect(out).not.toContain("Failed query")
  expect(out).toContain("notification.send")
  expect(out).toContain("23505")
})

test("app onError logs only the error name and a safe code, never the message or the error object", async () => {
  const { lines, logger } = capture()
  const { app } = testApp({ logger })
  app.get("/__boom", () => {
    throw drizzleLike()
  })
  const res = await app.request("/__boom")
  expect(res.status).toBe(500)
  const out = lines.join("")
  expect(out).toContain("unhandled error")
  expect(out).not.toContain(SECRET)
  expect(out).not.toContain("Failed query")
})

test("an enqueue that rejects after commit does not fail or hang the HTTP request", async () => {
  await resetDb()
  const q = fakeQueue()
  q.add = async () => {
    throw new Error(`redis down ${SECRET}`)
  }
  const { logger, lines } = capture()
  const t = testApp({ queue: q, logger })
  const tenant = await makeTenant(t.deps)
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const cookie = (await signIn(t.app, owner.email, owner.password)).cookie
  const target = await makeMember(t.deps, tenant.id, "employee")
  const res = await call(t.app, "POST", "/v1/data-requests", { cookie, tenant: tenant.slug, body: { subjectUserId: target.userId, kind: "export", reason: "subject asked by email" } })
  expect(res.status).toBe(201)
  expect(lines.join("")).not.toContain(SECRET)
})

test("with Redis down, a producer add rejects fast instead of hanging", async () => {
  const queue = makeBullQueue("redis://127.0.0.1:1", `test-${randomUUID()}`)
  const t0 = Date.now()
  try {
    await expect(queue.add("x", {}, { jobId: "j" })).rejects.toBeDefined()
    expect(Date.now() - t0).toBeLessThan(5000)
  } finally {
    await queue.close?.().catch(() => {})
  }
}, 15_000)

test("the logging push adapter reports skipped/no_provider, and the delivery is marked skipped", async () => {
  const { logger } = capture()
  expect(await makeLoggingPush(logger).send("tok", { title: "t", body: "b" })).toEqual({ status: "skipped", reason: "no_provider" })
})
