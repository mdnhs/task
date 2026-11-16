import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { testApp } from "../../../test/harness"
import { makeBullQueue, startWorker } from "./bull-queue"
import { registerJob } from "./queue"
import { fakeQueue } from "./fake-queue"

test("a BullMQ-backed Queue enqueues and a worker processes the job, then closes cleanly", async () => {
  const url = process.env.REDIS_URL!
  const name = `test-${randomUUID()}`
  const { deps } = testApp()
  const got = new Promise<unknown>((resolve) => registerJob("test.echo", async (data) => resolve(data)))
  const queue = makeBullQueue(url, name)
  const worker = startWorker(deps, url, name)
  try {
    await queue.add("test.echo", { hello: "world" }, { jobId: "j1" })
    expect(await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("job not processed")), 10_000))])).toEqual({ hello: "world" })
  } finally {
    await worker.close()
    await queue.close?.()
  }
})

test("FakeQueue records jobs, dedupes by jobId and drains", async () => {
  const q = fakeQueue()
  await q.add("a", 1, { jobId: "x" })
  await q.add("a", 2, { jobId: "x" })
  await q.add("b", 3)
  expect(q.jobs.map((j) => j.name)).toEqual(["a", "b"])
  const seen: string[] = []
  expect(await q.drain(async (n) => void seen.push(n))).toBe(2)
  expect(seen).toEqual(["a", "b"])
  expect(q.jobs).toEqual([])
})
