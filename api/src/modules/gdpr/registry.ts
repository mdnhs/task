import type { TenantTx } from "../../db/tenant-tx"

/**
 * A module's contribution to data-subject requests. `export` returns ONLY the subject's own data from this tenant as
 * JSON-safe values (for other people it may carry ids, never names/emails). `erase` anonymises or deletes that data in
 * the given tx and must be idempotent (a re-run after a crash finds nothing left). Handlers must not write the audit
 * log (the job records one entry after all handlers ran, keeping the audit lock last) and never touch `audit_events`.
 */
export type DsrHandler = {
  export(tx: TenantTx, tenantId: string, userId: string): Promise<Record<string, unknown>>
  /** `enqueue` runs jobs after the erase tx commits (e.g. deleting stored objects); a handler that has none to queue ignores it. */
  erase(tx: TenantTx, tenantId: string, userId: string, now: Date, enqueue?: (name: string, data: unknown, opts?: { delayMs?: number; key?: string }) => void): Promise<void>
}

const handlers = new Map<string, DsrHandler>()

/** Registers (or replaces) the handler of `module`. Later modules call this at startup, like registerJob. */
export function registerDsrHandler(module: string, h: DsrHandler): void {
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(module)) throw new Error(`Invalid DSR handler module name: ${module}`)
  handlers.set(module, h)
}

/** Handlers in registration order (the export bundle and the erase run both follow it). */
export function dsrHandlers(): [string, DsrHandler][] {
  return [...handlers.entries()]
}

/** Tests only: forget every handler. */
export function resetDsrHandlers(): void {
  handlers.clear()
}
