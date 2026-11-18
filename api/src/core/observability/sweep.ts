import type { Deps } from "../../deps"

/** A sweep is sharded when one run takes longer than this or handles more tenants than this (ruling S12, documented in b6-cutover.md; no sharding code yet). */
export const SWEEP_SHARD_AFTER_MS = 60_000
export const SWEEP_SHARD_AFTER_TENANTS = 250

/**
 * Per-run numbers of a sweep job that loops over all tenants (ruling S12): the batch size goes to `sweep_tenants_processed{job}` (the run duration is
 * already `queue_job_duration_seconds{name}`). Call `tenant()` once per tenant visited and `done()` in a `finally`; a run over the documented limits logs one warning.
 */
export function startSweep(d: Pick<Deps, "metrics" | "clock" | "logger">, job: string) {
  const started = d.clock.now().getTime()
  let tenants = 0
  return {
    tenant: () => void (tenants += 1),
    done: () => {
      d.metrics.gauge("sweep_tenants_processed", { job }).set(tenants)
      const ms = d.clock.now().getTime() - started
      if (ms > SWEEP_SHARD_AFTER_MS || tenants > SWEEP_SHARD_AFTER_TENANTS) d.logger.warn({ job, tenants, ms }, "sweep is over the sharding trigger")
    },
  }
}
