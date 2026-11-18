import { Writable } from "node:stream"
import { expect, test } from "vitest"
import { makeLogger } from "../core/observability/logger"
import { makeDb } from "./client"

// B7 review Z1: a dropped idle connection emits `error` on the pool; without a listener Node throws it and kills the process.
test("a pool error is logged once, redacted, and never thrown", async () => {
  const lines: string[] = []
  const destination = new Writable({ write: (chunk, _enc, cb) => (lines.push(String(chunk)), cb()) })
  const db = makeDb("postgres://app_user:s3cret-pw@127.0.0.1:1/x", { max: 1, logger: makeLogger({ level: "info", service: "db", destination }) })
  const err = Object.assign(new Error("terminating connection; postgres://app_user:s3cret-pw@127.0.0.1:1/x"), { code: "57P01" })
  expect(() => db.$client.emit("error", err, undefined)).not.toThrow()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain("57P01")
  expect(lines[0]).not.toContain("s3cret-pw")
  expect(lines[0]).not.toContain("postgres://")
  await db.$client.end()
})
