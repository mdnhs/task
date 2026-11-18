import { randomUUID } from "node:crypto"
import pino from "pino"
import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { eventJobId } from "../events/relay"
import { publish, relayOnce, subscribe } from "../events"
import { withTenant } from "../../db/tenant-tx"
import { exportJobId } from "../../modules/shift-reports/exports"
import { world } from "../../modules/shift-reports/world"
import { makeBullQueue, startWorker } from "./bull-queue"
import { fakeQueue } from "./fake-queue"
import { registerJob } from "./queue"
import { currentRequestId, runWithRequestId } from "./request-context"
import { resetSubscribers } from "../events"

// B8 Task 16: the request id travels in the job ENVELOPE (job options), never in `data`, so job schemas, ledger keys and jobIds are untouched. It is for log correlation only: it is
// length- and charset-checked wherever it is read and is never an identifier for authorization.

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})

describe("the request id in the job envelope (B8 T16)", () => {
  test("a job enqueued inside a request carries that request id in its options and NOT in its data; the jobId is the same as ever (golden)", async () => {
    const w = await world({ now: "2026-10-26T12:00:00.000Z" })
    const mine = "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10"
    const r = await call(w.app, "POST", "/v1/report-exports", { cookie: w.ops.cookie, tenant: "acme", body: { format: "csv", from: "2026-10-24", to: "2026-10-24" }, headers: { "x-request-id": mine } })
    expect(r.status, await r.clone().text()).toBe(202)
    expect(r.headers.get("x-request-id")).toBe(mine)
    const id = ((await r.json()) as { id: string }).id
    const job = w.queue.jobs.find((j) => j.name === "report.export")!
    expect(job.opts?.requestId).toBe(mine)
    expect(job.data).toEqual({ exportId: id, tenantId: w.tenant.id }) // the data object is exactly what it was: no request id in it
    expect(job.opts?.jobId).toBe(exportJobId(w.tenant.id, id, 1))
    // without a header the middleware makes one and that one is stamped
    const r2 = await call(w.app, "POST", "/v1/report-exports", { cookie: w.owner.cookie, tenant: "acme", body: { format: "csv", from: "2026-10-24", to: "2026-10-24" } })
    expect(r2.status).toBe(202)
    const made = r2.headers.get("x-request-id")!
    expect(w.queue.jobs.filter((j) => j.name === "report.export").at(-1)!.opts?.requestId).toBe(made)
  })

  test("golden jobIds: the ids of event and export jobs are the values they had before the envelope existed (hard-coded, so a change of the hashing or an id carrying the request id fails here)", () => {
    expect(eventJobId("evt-1", "mail", "notification.send", "k1")).toBe("cd85538c6473a9cb172ba45eb9fa50127a23a49134276e73650c3459f20f0382")
    expect(eventJobId("evt-1", "mail", "notification.send")).toBe("887635ccb039bc8e3e75e97ee915f4f3547f32307a16c1a7566d9f79f5752c90")
    expect(exportJobId("t1", "e1", 1)).toBe("10500fe23030bf55a20b7be5a1268c8133afb9c77ff30d69d816bf73a53cee7d")
  })

  test("a relay job carries the id of the event it came from (and nothing of it in its data)", async () => {
    const w = await world({ now: "2026-10-26T12:00:00.000Z" })
    subscribe("member.joined", "test.envelope", async (_e, ctx) => {
      ctx.enqueue("test.job", { hello: "world" })
      ctx.enqueue("test.job", { hello: "again" }, { key: "k2" })
    })
    await withTenant(w.deps.db, w.tenant.id, (tx) => publish(tx, { tenantId: w.tenant.id, type: "member.joined", payload: { userId: w.staff.userId, roleKey: "employee" }, actorId: w.staff.userId }, w.deps.clock.now()))
    const [{ id: eventId }] = (await w.q("select id from domain_events where type = 'member.joined'")) as { id: string }[]
    w.queue.jobs.length = 0
    expect(await relayOnce(w.deps)).toBeGreaterThan(0)
    const jobs = w.queue.jobs.filter((j) => j.name === "test.job")
    expect(jobs).toHaveLength(2)
    for (const j of jobs) {
      expect(j.opts?.requestId).toBe(eventId)
      expect(JSON.stringify(j.data)).not.toContain(eventId) // never in the data
    }
    expect(jobs[0].opts?.jobId).toBe(eventJobId(eventId, "test.envelope", "test.job")) // the jobId is still the hash of (event, subscriber, name, key)
  })

  test("a request id that is not id-shaped (too long, spaces, control characters) is never stamped; a good explicit one wins over the ambient one", async () => {
    const q = fakeQueue()
    await runWithRequestId("ambient-12345678", async () => {
      await q.add("a", {}, { requestId: "x".repeat(65) })
      await q.add("b", {}, { requestId: "bad id\r\nforged: 1" })
      await q.add("c", {}, { requestId: "explicit-87654321" })
      await q.add("d", {})
    })
    await q.add("e", {}) // outside any request
    const rid = (n: string) => q.jobs.find((j) => j.name === n)!.opts?.requestId
    expect(rid("a")).toBe("ambient-12345678") // the bad explicit value is ignored, the request's own id is used
    expect(rid("b")).toBe("ambient-12345678")
    expect(rid("c")).toBe("explicit-87654321")
    expect(rid("d")).toBe("ambient-12345678")
    expect(rid("e")).toBeUndefined()
    expect(currentRequestId()).toBeUndefined()
  })
})

describe("the worker logs with the request id (real BullMQ and Redis)", () => {
  test("the handler's logger is a child that carries the id of the job's envelope; a payload that merely holds a requestId field does not set it; an invalid stored id is ignored", async () => {
    const lines: Record<string, unknown>[] = []
    const logger = pino({ level: "debug" }, { write: (s: string) => void lines.push(JSON.parse(s)) } as never)
    const { deps } = testApp({ logger })
    const name = `test-${randomUUID()}`
    const url = process.env.REDIS_URL!
    const seen: string[] = []
    registerJob("test.rid", async (data, d) => {
      d.logger.info({ marker: (data as { n: number }).n }, "in the handler")
      if ((data as { n: number }).n === 1) await d.queue.add("test.chained", { from: 1 }) // AG3: a job enqueued FROM a handler carries the id of the job that caused it
      seen.push(String((data as { n: number }).n))
    })
    const queue = makeBullQueue(url, name)
    const worker = startWorker(deps, url, name)
    try {
      await queue.add("test.rid", { n: 1 }, { jobId: "j1", requestId: "req-aaaaaaaa" })
      await queue.add("test.rid", { n: 2, requestId: "payload-forged-id" }, { jobId: "j2" }) // no envelope id
      await queue.add("test.rid", { n: 3 }, { jobId: "j3", requestId: "bad id" }) // not id-shaped: dropped before it is stored
      for (let i = 0; i < 100 && seen.length < 3; i++) await new Promise((r) => setTimeout(r, 100))
      expect(seen.sort()).toEqual(["1", "2", "3"])
      const line = (n: number) => lines.find((l) => l.marker === n)!
      expect(line(1).requestId).toBe("req-aaaaaaaa")
      expect(line(3).requestId).toBeUndefined()
      expect(line(2).requestId).toBeUndefined() // AG3: the legacy data.requestId fallback is gone (a DSR job's data once collided with it)
      const chained = (deps.queue as unknown as { jobs: { name: string; opts?: { requestId?: string } }[] }).jobs.filter((j) => j.name === "test.chained")
      expect(chained.map((j) => j.opts?.requestId)).toEqual(["req-aaaaaaaa"])
      const stored = await queue.raw.getJob("j1")
      expect((stored!.data as Record<string, unknown>).requestId).toBeUndefined() // the data in Redis is the data the producer gave
      expect(stored!.opts).toMatchObject({ requestId: "req-aaaaaaaa" })
    } finally {
      await worker.close()
      await queue.close?.()
    }
  })
})
