import type { Logger } from "pino"
import { errorInfo } from "../safe-error"

/** What a report may carry. Ids only: never a message, a body, a header or a payload. `tenantId` is a field here (and in logs), never a metric label. */
export type ErrorContext = { requestId?: string; tenantId?: string; userId?: string; route?: string; jobName?: string; jobId?: string }

/**
 * Hook for error tracking (ruling S10). No vendor SDK in B7: a Sentry or OpenTelemetry adapter is a later 20-line file that
 * implements this interface and is chosen in `makeDeps`. `capture` must never throw and never block the response.
 */
export interface ErrorReporter {
  capture(err: unknown, ctx: ErrorContext): void
}

export const noopErrorReporter: ErrorReporter = { capture: () => {} }

/**
 * The default: one error log line with the error class name and the pg cause code only (the B2 ruling: Drizzle messages carry
 * query parameters), plus the ids of the context.
 */
export function makeLogErrorReporter(logger: Logger): ErrorReporter {
  return {
    capture: (err, ctx) => {
      if (ctx.jobName) return // a failed job is already logged by the worker (logJobFailure: name, job id, request id)
      logger.error({ ...ctx, ...errorInfo(err) }, "unhandled error")
    },
  }
}

/** Calls the reporter and swallows anything it throws: reporting must not turn a handled 500 into a crash. */
export function safeCapture(reporter: ErrorReporter, err: unknown, ctx: ErrorContext): void {
  try {
    reporter.capture(err, ctx)
  } catch {
    // a broken reporter is not allowed to break the error path
  }
}

/** Test fake: records what was captured. */
export type FakeErrorReporter = ErrorReporter & { captured: { err: unknown; ctx: ErrorContext }[] }
export function fakeErrorReporter(): FakeErrorReporter {
  const captured: FakeErrorReporter["captured"] = []
  return { captured, capture: (err, ctx) => void captured.push({ err, ctx }) }
}
