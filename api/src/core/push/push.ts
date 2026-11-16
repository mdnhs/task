import type { Logger } from "pino"

/** Sends one push message to one device token. Throw on failure; never log the token. */
export type PushSender = {
  send(token: string, msg: { title: string; body: string; data?: Record<string, string> }): Promise<void>
}

/**
 * Placeholder adapter until FCM (Android) exists: logs that a push would have gone out (no token, no content) and
 * resolves. Replace in makeDeps with the real FCM sender; the Deps contract does not change.
 */
export function makeLoggingPush(logger: Logger): PushSender {
  return {
    send: async () => {
      logger.info("push send skipped: no push provider configured")
    },
  }
}
