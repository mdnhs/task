import type { Logger } from "pino"

/** `skipped` = nothing was handed to a provider (e.g. none configured); void/`sent` = accepted by the provider. */
export type PushResult = { status: "sent" } | { status: "skipped"; reason: string }

/** Sends one push message to one device token. Throw on failure; never log the token. */
export type PushSender = {
  send(token: string, msg: { title: string; body: string; data?: Record<string, string> }): Promise<PushResult | void>
}

/**
 * Placeholder adapter until FCM (Android) exists: logs that a push could not go out (no token, no content) and
 * reports it as skipped (`no_provider`), never as sent. Replace in makeDeps with the real FCM sender; the Deps contract does not change.
 */
export function makeLoggingPush(logger: Logger): PushSender {
  return {
    send: async () => {
      logger.info("push send skipped: no push provider configured")
      return { status: "skipped", reason: "no_provider" }
    },
  }
}
