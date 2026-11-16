import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { testApp } from "../../../test/harness"
import { makeBullQueue, startWorker } from "./bull-queue"
import { registerJob } from "./queue"
import { eventJobId } from "../events/relay"
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

test("bus jobIds (with and without key) are accepted by BullMQ and processed; same jobId dedupes to one job", async () => {
  const url = process.env.REDIS_URL!
  const name = `test-${randomUUID()}`
  const { deps } = testApp()
  const seen: string[] = []
  registerJob("test.keyed", async (data) => void seen.push(String(data)))
  const queue = makeBullQueue(url, name)
  const worker = startWorker(deps, url, name)
  const wait = async (n: number) => {
    for (let i = 0; i < 100 && seen.length < n; i++) await new Promise((r) => setTimeout(r, 100))
  }
  try {
    const ev = randomUUID()
    await queue.add("test.keyed", "plain", { jobId: eventJobId(ev, "mail", "test.keyed") })
    await queue.add("test.keyed", "keyed", { jobId: eventJobId(ev, "mail", "test.keyed", "k1") })
    await wait(2)
    expect(seen.sort()).toEqual(["keyed", "plain"])
    await queue.add("test.keyed", "dup", { jobId: eventJobId(ev, "mail", "test.keyed") }) // same id again, after completion
    await queue.add("test.keyed", "dup", { jobId: eventJobId(ev, "mail", "test.keyed", "k1") })
    await new Promise((r) => setTimeout(r, 500))
    expect(seen).toHaveLength(2)
  } finally {
    await worker.close()
    await queue.close?.()
  }
})

test("FakeQueue rejects ':' in jobId like BullMQ", async () => {
  await expect(fakeQueue().add("a", 1, { jobId: "x:y:z" })).rejects.toThrow(/cannot contain/)
})
