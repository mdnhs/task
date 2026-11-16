// First platform owner bootstrap (the only way to create one; there is no HTTP route for it).
//   npm -w api run platform:owner -- --email person@example.com
// Connects as app_user (DATABASE_URL). Only for an existing, email-verified, 2FA-enrolled, non-erased user. Idempotent.
// Prints safe codes only: never the address back, never an error message.
import { makeDb } from "../src/db/client"
import { errorInfo } from "../src/core/safe-error"
import { BootstrapError, createPlatformOwner } from "../src/modules/platform-staff"

function emailArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--email")
  const v = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--email="))?.slice("--email=".length)
  return v && !v.startsWith("--") ? v : undefined
}

async function main(): Promise<number> {
  const email = emailArg(process.argv.slice(2))
  if (!email) {
    console.error("usage: npm -w api run platform:owner -- --email <address>")
    return 2
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is not set")
    return 2
  }
  const db = makeDb(url, { max: 1 })
  try {
    const r = await createPlatformOwner(db, new Date(), email)
    console.log(`platform owner ${r.outcome}: ${r.userId}`)
    return 0
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(`refused: ${err.code}`)
      return 1
    }
    const info = errorInfo(err)
    console.error(`failed: ${info.name}${info.code ? ` ${info.code}` : ""}`)
    return 1
  } finally {
    await db.$client.end()
  }
}

process.exitCode = await main()
