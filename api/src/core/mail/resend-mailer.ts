import { Resend } from "resend"
import type { Mailer } from "../../deps"

export type MailConfig = { apiKey: string; from: string }
export type MailConfigSource = { get(): Promise<MailConfig | null> }

const TTL_MS = 60_000

/** Sends through Resend. Config is read through `source` and cached for at most 60 s (or until invalidate()). */
export class ResendMailer implements Mailer {
  private cached: { at: number; config: MailConfig | null; client: Resend | null } | null = null
  private readonly source: MailConfigSource
  private readonly fallback: Mailer
  private readonly now: () => number

  constructor(o: { source: MailConfigSource; fallback: Mailer; now?: () => number }) {
    this.source = o.source
    this.fallback = o.fallback
    this.now = o.now ?? Date.now
  }

  invalidate(): void {
    this.cached = null
  }

  private async current() {
    const t = this.now()
    if (this.cached && t - this.cached.at < TTL_MS) return this.cached
    const config = await this.source.get()
    this.cached = { at: t, config, client: config ? new Resend(config.apiKey) : null }
    return this.cached
  }

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const { config, client } = await this.current()
    if (!config || !client) return this.fallback.send(msg)
    const { error } = await client.emails.send({ from: config.from, to: msg.to, subject: msg.subject, text: msg.text })
    // The SDK reports failures in the result rather than throwing.
    if (error) throw new Error(`resend ${error.name}: ${error.message}`)
  }
}
