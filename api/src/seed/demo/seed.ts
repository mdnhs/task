import pino from "pino"
import { fakeQueue } from "../../core/queue/fake-queue"
import { fakeBilling } from "../../modules/billing/fake-provider"
import { relayOnce, resetSubscribers } from "../../core/events"
import { registerSearchIndexers } from "../../modules/search/subscribers"
import type { Db } from "../../db/client"
import type { Clock, Deps } from "../../deps"
import { makeAnchor, todayIn, weekOffset } from "./anchor"
import { assertPassword, assertSameDatabase, assertSeedAllowed, DEMO_SLUGS, existingDemoTenants, SeedRefused, takeSeedLock } from "./guards"
import { buildPeople, indirectPairs } from "./people"
import { loadSource, NOT_SEEDED } from "./source"
import { seedTenant } from "./tenant"
import { buildSeedAuth, deleteUsers, ensurePlatformOwner, ensureUsers, noopMailer } from "./users"
import { deleteDemoTenants } from "./wipe"

export type SeedOptions = {
  clock: Clock
  /** SEED_DEMO_PASSWORD: 12+ characters, required, no default. Never logged, never in the report. */
  password: string
  /** The directory holding the mock JSON (public/data). */
  sourceDir: string
  /** YYYY-MM-DD the mock's frozen "today" becomes; default: today in the tenant timezone, read from `clock`. */
  anchor?: string
  /** Default `demo.example` (reserved, never a real mailbox). Must end in a reserved name (.example, .test, .invalid, .localhost). */
  emailDomain?: string
  /**
   * What the guard reads: NODE_ENV and the opt-in ALLOW_DEMO_SEED. Defaults to process.env. There is deliberately no option that skips the guard.
   */
  env?: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string }
  /** The app_owner connection (DATABASE_OWNER_URL). Needed only to re-seed an existing demo tenant (it wipes the tenant's seeded rows) or for `reset`. */
  owner?: Db
  /** Delete the demo tenants and their users first (never any other tenant: the guard already refused a database that holds one). */
  reset?: boolean
  /** SEED_PLATFORM_TOTP_SECRET: creates the platform owner when given (J4), otherwise none. */
  platformTotpSecret?: string
  /** Better Auth's secret and the app URL (hashing and sealing); defaults to process.env. */
  authEnv?: { BETTER_AUTH_SECRET?: string; APP_URL?: string }
}

export type SeedReport = {
  tenants: string[]
  users: number
  counts: Record<string, number>
  /** Every manager-of-manager pair [manager email, member email]: a manager sees only direct reports (F5), so these members are not in that manager's scope. */
  indirectReports: [manager: string, member: string][]
  warnings: string[]
  /** The anchor day the dates were moved to, and the public/data files that were (and were not) loaded. */
  anchor: string
  /** Days the weekday-bound dates (shift assignments, report shift dates) moved: a whole number of weeks, so weekdays are kept. */
  shiftOffsetDays: number
  loaded: string[]
  skipped: Record<string, string>
}

const RESERVED_DOMAIN = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.(?:example|test|invalid|localhost)$|^example\.(?:com|net|org)$/

/**
 * Loads the mock JSON into Postgres as the three demo tenants (shell/tenants.json). Order: arguments, the GUARD (reads only), the seed lock plus a re-run of the guard,
 * then the writes. A refusal (SeedRefused) writes nothing. Re-running the seed on its own demo tenants is allowed and yields the same tenants, users and refs, with every
 * date moved to the new anchor. It never contacts a mail, payment or storage provider: the mailer is a counter, the queue records and the relay runs only the search indexers.
 */
export const seedDemo = (db: Db, o: SeedOptions): Promise<SeedReport> => seedDemoInternal(db, o, {})

/** Test seam, not exported from index.ts: `beforeLock` runs after the first guard and before the lock, to prove the re-check closes that window. It cannot skip any check. */
export async function seedDemoInternal(db: Db, o: SeedOptions, hooks: { beforeLock?: () => Promise<void> }): Promise<SeedReport> {
  assertPassword(o.password)
  const emailDomain = (o.emailDomain ?? "demo.example").toLowerCase()
  if (!RESERVED_DOMAIN.test(emailDomain)) throw new SeedRefused("email_domain")
  const env = o.env ?? { NODE_ENV: process.env.NODE_ENV, ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED }
  // THE guard, one place. It reads EVERY connection the seed writes through: the owner (it sees all rows whatever RLS says) and app_user, and they must be ONE database.
  const check = async (): Promise<void> => {
    for (const c of o.owner ? [o.owner, db] : [db]) await assertSeedAllowed(c, { env, emailDomain })
    if (o.owner) await assertSameDatabase(db, o.owner)
  }
  await check()
  const secret = o.authEnv?.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET
  const appUrl = o.authEnv?.APP_URL ?? process.env.APP_URL
  if (!secret || !appUrl) throw new SeedRefused("auth_env_missing")
  if (o.platformTotpSecret !== undefined && !/^[A-Za-z0-9]{16,64}$/.test(o.platformTotpSecret)) throw new SeedRefused("totp_secret_invalid")
  const src = loadSource(o.sourceDir)
  const now = o.clock.now()
  const tz = src.org.timezone
  let anchor: ReturnType<typeof makeAnchor>
  let weekAnchor: ReturnType<typeof makeAnchor>
  let shiftOffsetDays: number
  try {
    anchor = makeAnchor({ mockToday: src.org.today, anchor: o.anchor ?? todayIn(now, tz), tz })
    // Weekday-bound dates (assignments, report shift dates) move by whole weeks so every report stays on a day its pattern runs, and never past the anchor day.
    const latest = src.reports.reduce((m, r) => (r.date > m ? r.date : m), "0000-00-00")
    shiftOffsetDays = weekOffset({ mockToday: src.org.today, anchor: anchor.today, latestMockDay: latest })
    weekAnchor = makeAnchor({ mockToday: src.org.today, anchor: anchor.today, tz, offsetDays: shiftOffsetDays })
  } catch {
    throw new SeedRefused("bad_anchor") // before anything is written or deleted
  }
  const existing = await existingDemoTenants(db)
  if ((existing.length > 0 || o.reset) && !o.owner) throw new SeedRefused("owner_required")

  // ---- from here on the seed writes: take the seed lock and re-run the guard under it, immediately before the first write ----
  await hooks.beforeLock?.()
  const unlock = await takeSeedLock(o.owner ?? db)
  try {
    await check()
    return await writeAll()
  } finally {
    await unlock()
  }

  async function writeAll(): Promise<SeedReport> {
    const { people, byMock, byName } = buildPeople(src, emailDomain)
    const platformEmail = `platform.owner@${emailDomain}`
    if (o.reset && o.owner) {
      await deleteDemoTenants(o.owner)
      await deleteUsers(o.owner, [...people.map((p) => p.email), platformEmail])
    }
    const mailer = noopMailer()
    const auth = buildSeedAuth(db, { BETTER_AUTH_SECRET: secret!, APP_URL: appUrl!, NODE_ENV: env.NODE_ENV }, mailer, o.clock)
    const userIds = await ensureUsers(db, auth, people, o.password)
    if (o.platformTotpSecret) await ensurePlatformOwner(db, auth, { email: platformEmail, password: o.password, totpSecret: o.platformTotpSecret, now })

    const owner = byName.get(src.users.find((u) => u.role === "owner")?.name ?? "")
    if (!owner) throw new SeedRefused("bad_source")
    const queue = fakeQueue()
    const deps = { db, clock: o.clock, queue, billing: fakeBilling(), logger: pino({ level: "silent" }), mailer, auth } as unknown as Deps
    const counts: Record<string, number> = {}
    const warnings: string[] = []
    if (shiftOffsetDays !== anchor.offsetDays) warnings.push(`shift dates moved by ${shiftOffsetDays} days (not ${anchor.offsetDays}) to keep weekdays`)
    const slugs: string[] = []
    for (const slug of DEMO_SLUGS) {
      const mock = src.tenants.find((t) => t.slug === slug)
      const sub = mock && src.subscriptions[mock.id]
      if (!mock || !sub) throw new SeedRefused("bad_source")
      const r = await seedTenant(db, deps, { src, anchor, weekAnchor, now, tz, people, byMock, byName, userIds, ownerId: userIds.get(owner.email)!, mock, sub, full: mock.id === "t1", owner: o.owner })
      slugs.push(slug)
      for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v
      warnings.push(...r.warnings)
    }
    await settleEvents(deps)
    counts.users = people.length + (o.platformTotpSecret ? 1 : 0)
    counts.verificationMailsSuppressed = mailer.suppressed
    counts.jobsQueued = queue.jobs.length // always 0: nothing the seed does enqueues work
    if (queue.jobs.length > 0) warnings.push(`${queue.jobs.length} jobs were recorded and dropped, none sent`)
    return { tenants: slugs, users: people.length, counts, indirectReports: indirectPairs(people), warnings, anchor: anchor.today, shiftOffsetDays, loaded: src.loaded, skipped: NOT_SEEDED }
  }
}

/**
 * The seed publishes the same domain events the services do (member.joined, team.created, task.created, ...). Run the relay here with ONLY the search indexers
 * registered, until nothing is pending: the search index is filled, every event is marked relayed, and no notification, email or webhook subscriber ever sees a seeded event.
 */
async function settleEvents(deps: Deps): Promise<void> {
  resetSubscribers()
  registerSearchIndexers()
  try {
    for (let i = 0; i < 100; i++) if ((await relayOnce(deps, 500)) === 0) break
  } finally {
    resetSubscribers()
  }
}

