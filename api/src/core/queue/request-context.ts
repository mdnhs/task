import { AsyncLocalStorage } from "node:async_hooks"

// The request id of the HTTP request being served, kept for the duration of the request so a job enqueued inside it can carry it in its ENVELOPE (job options, never the job `data`): the worker then logs
// with it and one id ties a request to the jobs it caused. It is a correlation label ONLY. It is never read as an identifier for authorization, never a key of a ledger or a jobId, and everything that reads
// one back (the producer, the worker) checks its length and charset first.

/** What an id from a client or a proxy may look like: 8 to 64 of letters, digits, `-` and `_` (a uuid, a trace id). Anything else is replaced, so a header can never forge a log line or a response header. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/

const store = new AsyncLocalStorage<{ requestId: string }>()

/** Runs `fn` with `requestId` as the ambient request id (the request-id middleware wraps the rest of the request in it). */
export const runWithRequestId = <T>(requestId: string, fn: () => Promise<T>): Promise<T> => store.run({ requestId }, fn)

/** The request id of the request being served, when there is one (a worker or a script has none). */
export const currentRequestId = (): string | undefined => store.getStore()?.requestId

/** The value when it is id-shaped (a string of 8 to 64 safe characters), else undefined. */
export const validRequestId = (v: unknown): string | undefined => (typeof v === "string" && v.length <= 64 && REQUEST_ID.test(v) ? v : undefined)

/** The id to stamp on a job: an explicit valid one (relay jobs pass their event id), else the ambient request's. */
export const stampRequestId = (explicit?: unknown): string | undefined => validRequestId(explicit) ?? currentRequestId()
