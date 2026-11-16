import type { Queue } from "./queue"

export type FakeJob = { name: string; data: unknown; opts?: { delayMs?: number; jobId?: string } }

/** In-memory Queue for tests: records jobs; `drain` runs and clears them. A repeated jobId is dropped (BullMQ semantics). */
export type FakeQueue = Queue & {
  jobs: FakeJob[]
  drain(run: (name: string, data: unknown) => Promise<void>): Promise<number>
}

export function fakeQueue(): FakeQueue {
  const jobs: FakeJob[] = []
  return {
    jobs,
    add: async (name, data, opts) => {
      if (opts?.jobId && jobs.some((j) => j.opts?.jobId === opts.jobId)) return
      jobs.push({ name, data, opts })
    },
    drain: async (run) => {
      let n = 0
      while (jobs.length > 0) {
        const j = jobs.shift()!
        await run(j.name, j.data)
        n++
      }
      return n
    },
  }
}
