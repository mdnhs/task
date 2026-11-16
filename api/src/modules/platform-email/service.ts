import { eq } from "drizzle-orm"
import { z } from "zod"
import { sanitizeMailError } from "../../core/mail/sanitize"
import { open, seal } from "../../core/crypto/secret-box"
import { AppError } from "../../core/errors"
import type { Db } from "../../db/client"
import { platformEmailSettings as t } from "../../db/schema"
import type { Deps } from "../../deps"
import type { Env } from "../../env"

export type EmailSettings =
  | { configured: false }
  | { configured: true; provider: "resend"; fromAddress: string; fromName: string; keyLast4: string; updatedAt: Date; updatedBy: string | null }

/** Secrets-free snapshot used in audit entries. */
export type EmailSettingsSnapshot = { configured: boolean; keyLast4?: string; fromAddress?: string; fromName?: string }
export type PlatformAuditEntry = { action: string; actorId: string; before: EmailSettingsSnapshot; after: EmailSettingsSnapshot; at: Date }
// TODO(B3): replace with the real platform audit table once platform staff auth exists.
export interface PlatformAuditSink { record(entry: PlatformAuditEntry): Promise<void> }
export class InMemoryAuditSink implements PlatformAuditSink {
  entries: PlatformAuditEntry[] = []
  async record(entry: PlatformAuditEntry): Promise<void> { this.entries.push(entry) }
}

export type EmailSettingsDeps = Pick<Deps, "env" | "clock" | "mailer"> & { audit: PlatformAuditSink }

export function secretsKey(env: Pick<Env, "SECRETS_KEY">): Buffer {
  if (!env.SECRETS_KEY) throw new Error("SECRETS_KEY is not set")
  return Buffer.from(env.SECRETS_KEY, "base64")
}

const snapshot = (s: EmailSettings): EmailSettingsSnapshot =>
  s.configured ? { configured: true, keyLast4: s.keyLast4, fromAddress: s.fromAddress, fromName: s.fromName } : { configured: false }

export async function getEmailSettings(db: Db): Promise<EmailSettings> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return { configured: false }
  return { configured: true, provider: "resend", fromAddress: r.fromAddress, fromName: r.fromName, keyLast4: r.apiKeyLast4, updatedAt: r.updatedAt, updatedBy: r.updatedBy }
}

const email = z.email()
const bad = (code: string, title: string) => new AppError(400, code, title)

export async function setEmailSettings(
  db: Db,
  deps: EmailSettingsDeps,
  input: { apiKey?: string; fromAddress: string; fromName: string },
  actorId: string,
): Promise<void> {
  const fromAddress = input.fromAddress.trim()
  const fromName = input.fromName.trim()
  if (!email.safeParse(fromAddress).success) throw bad("invalid_from_address", "Invalid from address")
  // Name goes into a header: no line breaks or angle brackets/quotes that could smuggle headers or addresses.
  if (!fromName || fromName.length > 100 || /[\r\n<>"]/.test(fromName)) throw bad("invalid_from_name", "Invalid from name")
  const apiKey = input.apiKey?.trim()
  if (apiKey !== undefined && (!apiKey.startsWith("re_") || apiKey.length < 20 || /\s/.test(apiKey))) {
    throw bad("invalid_api_key", "Invalid API key")
  }

  const before = await getEmailSettings(db)
  if (!before.configured && !apiKey) throw bad("api_key_required", "API key required")

  const key = secretsKey(deps.env)
  const now = deps.clock.now()
  const values = { fromAddress, fromName, updatedBy: actorId, updatedAt: now }
  if (apiKey) {
    const keyValues = { ...values, apiKeyCiphertext: seal(apiKey, key), apiKeyLast4: apiKey.slice(-4) }
    await db.insert(t).values({ id: 1, ...keyValues }).onConflictDoUpdate({ target: t.id, set: keyValues })
  } else {
    await db.update(t).set(values).where(eq(t.id, 1))
  }

  const after = await getEmailSettings(db)
  await deps.audit.record({ action: "platform.email_settings.updated", actorId, before: snapshot(before), after: snapshot(after), at: now })
  deps.mailer.invalidate?.()
}

/** Decrypts the stored key. Only the mailer config source calls this. */
export async function loadMailConfig(db: Db, env: Pick<Env, "SECRETS_KEY">): Promise<{ apiKey: string; from: string } | null> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return null
  return { apiKey: open(r.apiKeyCiphertext, secretsKey(env)), from: `${r.fromName} <${r.fromAddress}>` }
}

export async function sendTestEmail(deps: Pick<Deps, "mailer">, to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!email.safeParse(to).success) return { ok: false, error: "invalid recipient address" }
  try {
    await deps.mailer.send({ to, subject: "OpsDesk test email", text: "This is a test email from OpsDesk. Your email settings work." })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: sanitizeMailError(err) }
  }
}
