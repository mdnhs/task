import type { Deps } from "../../deps"

/** Background-job producer. Jobs run after the enqueuing tx commits, in the worker process (src/worker.ts). */
export type Queue = {
  add(name: string, data: unknown, opts?: { delayMs?: number; jobId?: string }): Promise<void>
  close?(): Promise<void>
}

export type JobHandler = (data: unknown, deps: Deps) => Promise<void>

const handlers = new Map<string, JobHandler>()

/** Registers the worker-side handler for a job name (later tasks call this at import time). */
export function registerJob(name: string, handler: JobHandler): void {
  handlers.set(name, handler)
}

export function runJob(name: string, data: unknown, deps: Deps): Promise<void> {
  const h = handlers.get(name)
  if (!h) return Promise.reject(new Error(`No handler registered for job: ${name}`))
  return h(data, deps)
}
