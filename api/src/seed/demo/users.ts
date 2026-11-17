import { and, eq, inArray } from "drizzle-orm"
import { symmetricEncrypt } from "better-auth/crypto"
import pino from "pino"
import type { Db } from "../../db/client"
import { account, platformStaff, session, twoFactor, user } from "../../db/schema"
import { buildAuth } from "../../modules/auth/auth"
import { createPlatformOwner } from "../../modules/platform-staff/bootstrap"
import type { Env } from "../../env"
import type { Mailer } from "../../deps"
import type { Person } from "./people"

export type SeedAuth = ReturnType<typeof buildAuth>

/** A mailer that sends nothing. The seed never talks to a mail provider; it only counts what Better Auth tried to send (the verification mail of each sign-up). */
export function noopMailer(): Mailer & { suppressed: number } {
  const m = { suppressed: 0, send: async () => { m.suppressed++ } }
  return m
}

/** Better Auth with the seed's own settings. Only the secret, the app URL and the environment name matter here (hashing, sealing a TOTP secret). */
export function buildSeedAuth(db: Db, env: { BETTER_AUTH_SECRET: string; APP_URL: string; NODE_ENV?: string }, mailer: Mailer, clock: { now(): Date }): SeedAuth {
  return buildAuth({ env: { BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET, APP_URL: env.APP_URL, NODE_ENV: env.NODE_ENV ?? "development" } as Env, db, clock, mailer, logger: pino({ level: "silent" }) })
}

/**
 * Creates (or finds, by email) a verified Better Auth user whose password is `password`. A new user goes through Better Auth's own sign-up, so the hash is
 * Better Auth's (scrypt); an existing one gets the current password hashed the same way, so a re-run always leaves the demo password in force.
 * Returns the user id. The password is never logged or returned.
 */
export async function ensureUser(db: Db, auth: SeedAuth, p: { email: string; name: string }, password: string): Promise<string> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, p.email))
  let id = existing?.id
  if (!id) {
    const created = await auth.api.signUpEmail({ body: { email: p.email, password, name: p.name } })
    id = created.user.id
  } else {
    const ctx = await auth.$context
    await db.update(account).set({ password: await ctx.password.hash(password) }).where(and(eq(account.userId, id), eq(account.providerId, "credential")))
  }
  await db.update(user).set({ emailVerified: true, name: p.name }).where(eq(user.id, id))
  return id
}

export async function ensureUsers(db: Db, auth: SeedAuth, people: Person[], password: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const p of people) ids.set(p.email, await ensureUser(db, auth, p, password))
  return ids
}

/**
 * The platform owner (J4): created ONLY when a TOTP secret is supplied. The user is enrolled through Better Auth's own two-factor flow (so the backup codes, the
 * enabled flag and the sealing are Better Auth's), then the stored secret is replaced by `totpSecret` sealed the same way (symmetricEncrypt with the app secret),
 * so the operator's authenticator, not a random secret nobody saw, generates the codes. `totpSecret` is the raw TOTP key string (an authenticator app shows its base32
 * form). The backup codes are discarded: nobody ever sees them. Finally the existing bootstrap makes the user the platform owner.
 */
export async function ensurePlatformOwner(db: Db, auth: SeedAuth, o: { email: string; password: string; totpSecret: string; now: Date }): Promise<string> {
  const id = await ensureUser(db, auth, { email: o.email, name: "Platform Owner" }, o.password)
  const ctx = await auth.$context
  const [u] = await db.select({ tfa: user.twoFactorEnabled }).from(user).where(eq(user.id, id))
  if (!u.tfa) {
    const login = await auth.api.signInEmail({ body: { email: o.email, password: o.password }, returnHeaders: true })
    const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
    await auth.api.enableTwoFactor({ body: { password: o.password }, headers: new Headers({ cookie }) })
  }
  const sealed = await symmetricEncrypt({ key: ctx.secretConfig, data: o.totpSecret })
  const rows = await db.select({ id: twoFactor.id }).from(twoFactor).where(eq(twoFactor.userId, id))
  if (rows.length === 0) throw new Error("two-factor enrolment left no row")
  await db.update(twoFactor).set({ secret: sealed, verified: true, failedVerificationCount: 0, lockedUntil: null }).where(eq(twoFactor.userId, id))
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id))
  await db.delete(session).where(eq(session.userId, id)) // the enrolment sign-in's session: its cookie went nowhere, so it must not outlive the run
  await createPlatformOwner(db, o.now, o.email)
  return id
}

/** Deletes the demo accounts (reset only): the platform staff row first (no cascade), then the users (sessions, accounts, two-factor secrets cascade). */
export async function deleteUsers(owner: Db, emails: string[]): Promise<void> {
  if (emails.length === 0) return
  const ids = (await owner.select({ id: user.id }).from(user).where(inArray(user.email, emails))).map((r) => r.id)
  if (ids.length === 0) return
  await owner.transaction(async (tx) => {
    await tx.delete(platformStaff).where(inArray(platformStaff.userId, ids))
    await tx.delete(user).where(inArray(user.id, ids))
  })
}
