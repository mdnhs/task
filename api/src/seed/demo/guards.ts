import { count, inArray, notInArray, sql } from "drizzle-orm"
import type { Db } from "../../db/client"
import { tenants, user } from "../../db/schema"

/** The only tenants the seed may ever write to or delete: the demo set from shell/tenants.json. A database holding anything else is refused. */
export const DEMO_SLUGS = ["northgate", "harbourline", "millbrook"] as const

export type SeedRefusal = "password_required" | "opt_in_required" | "other_tenants" | "foreign_users" | "auth_env_missing" | "owner_required" | "bad_source" | "email_domain" | "bad_anchor" | "totp_secret_invalid" | "connections_differ"

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


/**
 * Which database a connection really talks to: name, server port and address, plus the cluster's system identifier when the role may read it (pg_control_system() is
 * restricted on some servers; when either role cannot read it the comparison falls back to name + port + address, which still tells two databases or two servers apart).
 */
async function identity(db: Db): Promise<string> {
  const base = (await db.execute(sql`select current_database() as d, inet_server_port()::text as p, coalesce(inet_server_addr()::text, '') as a`)).rows[0] as { d: string; p: string; a: string }
  let sys = ""
  try {
    sys = String(((await db.execute(sql`select system_identifier::text as s from pg_control_system()`)).rows[0] as { s: string }).s)
  } catch {
    sys = "" // not readable by this role
  }
  return JSON.stringify({ d: base.d, p: base.p, a: base.a, sys })
}

/** The guard reads one database and `--reset` / a re-run delete through the owner connection: both must be the SAME database, or the guard would vouch for the wrong one. */
export async function assertSameDatabase(a: Db, b: Db): Promise<void> {
  const [x, y] = [JSON.parse(await identity(a)), JSON.parse(await identity(b))] as { d: string; p: string; a: string; sys: string }[]
  const sameCluster = x.sys && y.sys ? x.sys === y.sys : true
  if (x.d !== y.d || x.p !== y.p || x.a !== y.a || !sameCluster) throw new SeedRefused("connections_differ")
}

/** Session-level advisory lock key for "a demo seed is running" (two seeds never interleave). */
const SEED_LOCK_KEY = 0x64656d6f

/**
 * Takes the seed lock on a dedicated connection, to be called IMMEDIATELY before the first write. The caller re-runs the guard after it returns. Covered: two seeds
 * (or a seed and a reset) never run at once, and the re-check sits milliseconds before the first write. NOT covered: a non-seed process creating a foreign tenant after the
 * re-check (tenant creation takes no such lock, and holding a table lock would block the seed's own writes). That residual window is harmless to foreign data: every delete the seed
 * issues names the demo slugs (wipe.ts) and every write goes to a demo-slug tenant or a demo-domain user.
 */
export async function takeSeedLock(db: Db): Promise<() => Promise<void>> {
  const client = await db.$client.connect()
  try {
    await client.query("select pg_advisory_lock($1)", [SEED_LOCK_KEY])
  } catch (e) {
    client.release()
    throw e
  }
  return async () => {
    try {
      await client.query("select pg_advisory_unlock($1)", [SEED_LOCK_KEY])
    } finally {
      client.release()
    }
  }
}
