import { count, inArray, notInArray, sql } from "drizzle-orm"
import type { Db } from "../../db/client"
import { tenants, user } from "../../db/schema"

/** The only tenants the seed may ever write to or delete: the demo set from shell/tenants.json. A database holding anything else is refused. */
export const DEMO_SLUGS = ["northgate", "harbourline", "millbrook"] as const

export type SeedRefusal = "password_required" | "opt_in_required" | "other_tenants" | "foreign_users" | "auth_env_missing" | "owner_required" | "bad_source" | "email_domain" | "bad_anchor" | "totp_secret_invalid"

/** A refusal. `code` is safe to print; the message never carries a value (no password, no address, no URL). */
export class SeedRefused extends Error {
  constructor(public readonly code: SeedRefusal) {
    super(`seed refused: ${code}`)
    this.name = "SeedRefused"
  }
}

export const MIN_PASSWORD = 12

export function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new SeedRefused("password_required")
}

/**
 * THE guard. It runs once, before any write, and only reads. There is no argument that skips it: the inputs are the environment (opt-in and NODE_ENV)
 * and what the database already holds, nothing else.
 *
 *  1. The explicit opt-in `ALLOW_DEMO_SEED=1` is ALWAYS required (production or not): a typed command alone never seeds. NODE_ENV=production without it
 *     is the same refusal, and with it the checks below still apply.
 *  2. The database must hold no tenant outside the demo set. A host name cannot tell a demo from a production database, so this is the real guard:
 *     a database with a real customer in it is refused whatever the environment says.
 *  3. No account may exist outside the demo email domain (a production database before its first tenant already holds real sign-ups).
 */
export async function assertSeedAllowed(db: Db, o: { env: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string }; emailDomain: string }): Promise<void> {
  if (o.env.ALLOW_DEMO_SEED !== "1") throw new SeedRefused("opt_in_required")
  const [other] = await db.select({ n: count() }).from(tenants).where(notInArray(tenants.slug, [...DEMO_SLUGS]))
  if (Number(other.n) > 0) throw new SeedRefused("other_tenants")
  const suffix = `@${o.emailDomain.toLowerCase()}`
  const [foreign] = await db.select({ n: count() }).from(user).where(sql`lower(${user.email}) not like ${"%" + suffix.replace(/[\\%_]/g, (c) => `\\${c}`)}`)
  if (Number(foreign.n) > 0) throw new SeedRefused("foreign_users")
}

/** The ids of the demo tenants that already exist. */
export async function existingDemoTenants(db: Db): Promise<{ id: string; slug: string }[]> {
  return db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(inArray(tenants.slug, [...DEMO_SLUGS]))
}

