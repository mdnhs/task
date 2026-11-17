// Demo seed: loads public/data/**/*.json into Postgres as the three demo tenants (northgate, harbourline, millbrook).
//   ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=... npm -w api run seed:demo -- [--reset] [--anchor 2026-12-01]
//
// DEMO DATA ONLY. It writes a lot of rows and creates users with a password, so it refuses unless ALL of these hold (guards.ts, checked before any write):
//   - ALLOW_DEMO_SEED=1 (always required, in every environment; NODE_ENV=production without it is the same refusal)
//   - the database holds no tenant other than the three demo tenants (a re-run on its own demo tenants is fine)
//   - the database holds no account outside the demo email domain
// There is no flag or variable that skips these. Connects as app_user (DATABASE_URL); DATABASE_OWNER_URL is used only to re-seed an existing demo tenant or for --reset.
// Prints counts, file names and safe codes only: never the password, never an error message (they can carry SQL parameters).
import { fileURLToPath } from "node:url"
import { makeDb, type Db } from "../src/db/client"
import { errorInfo } from "../src/core/safe-error"
import { seedDemo, SeedRefused } from "../src/seed/demo"

const USAGE = "usage: ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=... npm -w api run seed:demo -- [--reset] [--anchor YYYY-MM-DD]"

function parseArgs(argv: string[]): { reset: boolean; anchor?: string } | null {
  let reset = false
  let anchor: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--reset") reset = true
    else if (a === "--anchor" || a.startsWith("--anchor=")) {
      const v = a === "--anchor" ? argv[++i] : a.slice("--anchor=".length)
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
      anchor = v
    } else return null // any other argument is an error, never silently ignored
  }
  return { reset, anchor }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error(USAGE)
    return 2
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is not set")
    return 2
  }
  const started = Date.now()
  const db = makeDb(url, { max: 2 })
  let owner: Db | undefined
  try {
    owner = process.env.DATABASE_OWNER_URL ? makeDb(process.env.DATABASE_OWNER_URL, { max: 2 }) : undefined
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED === "1") console.warn("NODE_ENV=production: seeding is allowed only because ALLOW_DEMO_SEED=1 is set and the database holds nothing but demo tenants")
    const report = await seedDemo(db, {
      clock: { now: () => new Date() },
      password: process.env.SEED_DEMO_PASSWORD as string, // validated (12+ characters) by seedDemo; undefined is a refusal
      sourceDir: fileURLToPath(new URL("../../public/data/", import.meta.url)),
      anchor: args.anchor,
      emailDomain: process.env.SEED_EMAIL_DOMAIN || undefined,
      env: { NODE_ENV: process.env.NODE_ENV, ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED },
      owner,
      reset: args.reset,
      platformTotpSecret: process.env.SEED_PLATFORM_TOTP_SECRET || undefined,
      authEnv: { BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, APP_URL: process.env.APP_URL },
    })
    console.log(`seeded ${report.tenants.join(", ")} (${report.users} users, anchor ${report.anchor}) in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    console.log(`counts: ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`)
    console.log(`loaded: ${report.loaded.join(" ")}`)
    for (const [files, why] of Object.entries(report.skipped)) console.log(`not seeded: ${files}: ${why}`)
    for (const w of report.warnings) console.warn(`warning: ${w}`)
    if (report.indirectReports.length) console.log(`indirect reports (not in the manager's scope, F5): ${report.indirectReports.map(([m, p]) => `${m} > ${p}`).join("; ")}`)
    return 0
  } catch (err) {
    if (err instanceof SeedRefused) {
      console.error(`refused: ${err.code}`)
      return 1
    }
    const info = errorInfo(err)
    console.error(`failed: ${info.name}${info.code ? ` ${info.code}` : ""}`)
    return 1
  } finally {
    await db.$client.end()
    await owner?.$client.end()
  }
}

process.exitCode = await main()
