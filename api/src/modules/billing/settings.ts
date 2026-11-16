import { eq, inArray } from "drizzle-orm"
import { buildKeyring, open, seal, type KeyringEnv } from "../../core/crypto/secret-box"
import { AppError } from "../../core/errors"
import type { Db } from "../../db/client"
import { platformBillingSettings as t, plans } from "../../db/schema"
import type { Deps } from "../../deps"
import type { Env } from "../../env"
import { recordPlatformAudit, type PlatformTx } from "../platform-audit"
import type { AuditSnapshot } from "../platform-email/service"
import { StripeBillingProvider, type StripeConfig } from "./stripe"

/** AADs binding each stored secret to its column; a ciphertext copied elsewhere will not open. */
export const BILLING_SECRET_AAD = "platform.billing.stripe.secret_key"
export const BILLING_WEBHOOK_AAD = "platform.billing.stripe.webhook_secret"

export type BillingSettings =
  | { configured: false }
  | {
      configured: true; provider: "stripe"; secretKeyLast4: string; webhookSecretLast4: string; publishableKey: string | null
      priceMap: Record<string, string>; updatedAt: Date; updatedBy: string | null
    }

export type BillingSettingsDeps = Pick<Deps, "env" | "clock" | "billing">

const snapshot = (s: BillingSettings): AuditSnapshot =>
  s.configured
    ? { configured: true, secretKeyLast4: s.secretKeyLast4, webhookSecretLast4: s.webhookSecretLast4, publishableKey: s.publishableKey, priceMap: s.priceMap }
    : { configured: false }

export async function getBillingSettings(db: Db | PlatformTx): Promise<BillingSettings> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return { configured: false }
  return {
    configured: true, provider: "stripe", secretKeyLast4: r.secretKeyLast4, webhookSecretLast4: r.webhookSecretLast4, publishableKey: r.publishableKey,
    priceMap: r.priceMap, updatedAt: r.updatedAt, updatedBy: r.updatedBy,
  }
}

const bad = (code: string, title: string) => new AppError(400, code, title)

export type BillingSettingsInput = { secretKey?: string; webhookSecret?: string; publishableKey?: string | null; priceMap?: Record<string, string> }

export async function setBillingSettings(db: Db, deps: BillingSettingsDeps, input: BillingSettingsInput, actorId: string): Promise<void> {
  const secretKey = input.secretKey?.trim()
  const webhookSecret = input.webhookSecret?.trim()
  const publishableKey = input.publishableKey === undefined ? undefined : input.publishableKey === null || input.publishableKey.trim() === "" ? null : input.publishableKey.trim()
  if (secretKey !== undefined && !/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,200}$/.test(secretKey)) throw bad("invalid_secret_key", "Invalid secret key")
  if (webhookSecret !== undefined && !/^whsec_[A-Za-z0-9+/=_-]{10,200}$/.test(webhookSecret)) throw bad("invalid_webhook_secret", "Invalid webhook secret")
  if (publishableKey && !/^pk_(test|live)_[A-Za-z0-9]{10,200}$/.test(publishableKey)) throw bad("invalid_publishable_key", "Invalid publishable key")
  if (input.priceMap) {
    for (const [plan, price] of Object.entries(input.priceMap)) {
      if (!/^price_[A-Za-z0-9]{3,200}$/.test(price)) throw bad("invalid_price_id", "Invalid price id")
      if (!/^[a-z0-9_-]{1,64}$/.test(plan)) throw bad("invalid_plan_id", "Invalid plan id")
    }
  }
  const now = deps.clock.now()
  // Settings write + platform audit entry in ONE transaction: neither exists without the other.
  await db.transaction(async (tx) => {
    if (input.priceMap && Object.keys(input.priceMap).length) {
      const found = await tx.select({ id: plans.id }).from(plans).where(inArray(plans.id, Object.keys(input.priceMap)))
      if (found.length !== Object.keys(input.priceMap).length) throw new AppError(422, "unknown_plan", "Unprocessable Entity")
    }
    const before = await getBillingSettings(tx)
    if (!before.configured && (!secretKey || !webhookSecret)) throw bad("secret_required", "Secret key and webhook secret required")
    const ring = buildKeyring(deps.env)
    const values = {
      updatedBy: actorId, updatedAt: now,
      ...(publishableKey !== undefined ? { publishableKey } : {}),
      ...(input.priceMap ? { priceMap: input.priceMap } : {}),
      ...(secretKey ? { secretKeyCiphertext: seal(secretKey, ring, BILLING_SECRET_AAD), secretKeyLast4: secretKey.slice(-4) } : {}),
      ...(webhookSecret ? { webhookSecretCiphertext: seal(webhookSecret, ring, BILLING_WEBHOOK_AAD), webhookSecretLast4: webhookSecret.slice(-4) } : {}),
    }
    if (!before.configured) {
      await tx.insert(t).values({ id: 1, ...values } as typeof t.$inferInsert)
    } else {
      await tx.update(t).set(values).where(eq(t.id, 1))
    }
    const after = await getBillingSettings(tx)
    await recordPlatformAudit(tx, { action: "platform.billing_settings.updated", entity: "platform_billing_settings", entityId: "1", actorId, before: snapshot(before), after: snapshot(after) }, now)
  })
  deps.billing.invalidate?.()
}

/** Decrypts the stored credentials. Only the billing config source calls this. */
export async function loadStripeConfig(db: Db, env: KeyringEnv): Promise<StripeConfig | null> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return null
  const ring = buildKeyring(env)
  return { secretKey: open(r.secretKeyCiphertext, ring, BILLING_SECRET_AAD), webhookSecret: open(r.webhookSecretCiphertext, ring, BILLING_WEBHOOK_AAD) }
}

/** Env bootstrap, used only when no DB settings exist. */
export function envStripeConfig(env: Env): StripeConfig | null {
  return env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET } : null
}

const TTL_MS = 60_000

/** The production provider: Stripe, config cached 60 s (settings update calls invalidate()). Unconfigured: every call is 503 billing_not_configured. */
export function makeBilling({ env, db }: { env: Env; db: Db }): StripeBillingProvider {
  let cached: { at: number; cfg: StripeConfig | null } | undefined
  const source = {
    get: async (): Promise<StripeConfig | null> => {
      if (cached && Date.now() - cached.at < TTL_MS) return cached.cfg
      // Without SECRETS_KEY (dev) stored settings cannot be decrypted, so skip straight to env.
      const stored = env.SECRETS_KEY || env.SECRETS_KEYS ? await loadStripeConfig(db, env) : null
      const cfg = stored ?? envStripeConfig(env)
      cached = { at: Date.now(), cfg }
      return cfg
    },
    invalidate: () => {
      cached = undefined
    },
  }
  return new StripeBillingProvider(source)
}

/** Price id for a plan: the platform price map first, then the plan's own provider_price_ids entry. */
export async function resolvePriceId(db: Db, providerId: string, plan: { id: string; providerPriceIds: Record<string, string> }): Promise<string | null> {
  const [r] = await db.select({ priceMap: t.priceMap }).from(t).where(eq(t.id, 1))
  return r?.priceMap?.[plan.id] ?? plan.providerPriceIds[providerId] ?? null
}
