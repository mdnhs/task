// Restore drill, steps 3 and 4 (deploy/scripts/restore-drill.sh): against a RESTORED scratch database, verify the audit chain of every tenant.
//   DRILL_DATABASE_URL=postgres://postgres:...@host/scratch tsx scripts/restore-verify.ts
// Refuses a database whose name does not start with `restore_drill_` (it must never point at the live database). Read-only. Prints tenant slugs and
// counts, never a row. Exit 0 all chains intact, 1 a chain is broken (or no tenant found), 2 bad usage.
import { pathToFileURL } from "node:url"
import pg from "pg"
import { makeDb } from "../src/db/client"
import { verifyChain } from "../src/modules/audit/verify"
import { makeLogger } from "../src/core/observability/logger"

export async function verifyAllChains(url: string, log: (line: string) => void = console.log): Promise<boolean> {
  const name = new URL(url).pathname.replace(/^\//, "")
  if (!name.startsWith("restore_drill_")) throw new Error("refused: the database name must start with restore_drill_")
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  pool.on("error", () => {})
  const tenants = (await pool.query<{ id: string; slug: string }>("select id::text, slug from tenants order by slug")).rows
  await pool.end()
  if (tenants.length === 0) { log("restore-verify: no tenants in the restored database"); return false }
  const db = makeDb(url, { logger: makeLogger({ level: "silent", service: "restore-verify" }) })
  let ok = true
  try {
    for (const t of tenants) {
      const r = await verifyChain(db, t.id)
      if (r.ok) log(`audit chain ok: ${t.slug} (head seq ${r.head?.seq ?? 0})`)
      else { ok = false; log(`audit chain BROKEN: ${t.slug}`) }
    }
  } finally {
    await db.$client.end()
  }
  return ok
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DRILL_DATABASE_URL
  if (!url) { console.error("restore-verify: DRILL_DATABASE_URL is not set"); process.exit(2) }
  verifyAllChains(url).then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(`restore-verify: failed (${(e as Error).message.slice(0, 120)})`); process.exit(1) })
}
