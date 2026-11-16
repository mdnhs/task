import type { Logger } from "pino"
import type { Mailer } from "../../deps"

/** Dev/test mailer: logs that a mail was suppressed. Recipient and subject only, never the body. */
export class ConsoleMailer implements Mailer {
  constructor(private logger: Pick<Logger, "info">) {}
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.logger.info({ to: msg.to, subject: msg.subject }, "mail suppressed")
  }
}

/** Production fallback when nothing is configured: fails loudly so the caller's error log fires. */
export class FailingMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error("email not configured")
  }
}
