import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { twoFactor } from "better-auth/plugins/two-factor"
import type { Db } from "../../db/client"
import * as schema from "../../db/schema"
import type { Clock } from "../../deps"
import type { Env } from "../../env"

const DAY = 24 * 60 * 60

type AuthDeps = { env: Env; db: Db; clock: Clock }

/**
 * Better Auth instance. Our own idle check (requireSession) governs session lifetime:
 * Better Auth's absolute `expiresIn` is 30 days with a daily rolling refresh, so it never
 * fires first. It uses real time internally, which is why the idle clock is ours (deps.clock).
 */
export function buildAuth({ env, db, clock }: AuthDeps) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  // Both id and secret must be non-empty; empty strings never register a provider.
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
  }
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    socialProviders.microsoft = { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET }
  }

  return betterAuth({
    appName: "OpsDesk",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders,
    plugins: [twoFactor({ issuer: "OpsDesk" })],
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      additionalFields: { lastSeenAt: { type: "date", required: false, input: false } },
    },
    advanced: {
      // Explicit: Better Auth otherwise skips origin/CSRF checks when NODE_ENV=test, hiding bugs from tests.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      session: {
        create: { before: async (s) => ({ data: { ...s, lastSeenAt: clock.now() } }) },
      },
    },
  })
}

export type Auth = ReturnType<typeof buildAuth>
