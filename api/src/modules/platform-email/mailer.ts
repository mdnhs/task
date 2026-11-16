import type { Logger } from "pino"
import { ConsoleMailer, FailingMailer } from "../../core/mail/console-mailer"
import { ResendMailer, type MailConfig } from "../../core/mail/resend-mailer"
import type { Db } from "../../db/client"
import type { Mailer } from "../../deps"
import type { Env } from "../../env"
import { loadMailConfig } from "./service"

/**
 * Mailer selection, resolved per send (cached 60 s): DB settings (platform admin) win, then the env
 * bootstrap (RESEND_API_KEY + MAIL_FROM), else production fails loudly and dev/test only logs.
 */
export function makeMailer({ env, db, logger }: { env: Env; db: Db; logger: Logger }): Mailer & { invalidate(): void } {
  const fallback = env.NODE_ENV === "production" ? new FailingMailer() : new ConsoleMailer(logger)
  const envConfig = (): MailConfig | null =>
    env.RESEND_API_KEY && env.MAIL_FROM ? { apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM } : null
  const source = {
    get: async (): Promise<MailConfig | null> => {
      // Without SECRETS_KEY (dev) stored settings can't be decrypted, so skip straight to env.
      const stored = env.SECRETS_KEY ? await loadMailConfig(db, env) : null
      return stored ?? envConfig()
    },
  }
  return new ResendMailer({ source, fallback })
}
