#!/usr/bin/env node
// Fails when a secret or server-only value reached the client bundle (B6 global constraint). Run after `next build`:
//   node scripts/check-bundle.mjs [dir]        default: .next/static (everything the browser can download)
// Searches every file under the directory for: the value of API_URL (when set and long enough to mean something), `odk_` (API keys),
// BETTER_AUTH_SECRET, sk_live, sk_test and whsec_. It prints the pattern and the file, never the match: a leaked secret must not land in CI logs.
// Exit codes: 0 clean, 1 found, 2 the directory does not exist (the build must run first).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const dir = path.resolve(process.argv[2] ?? ".next/static")
if (!existsSync(dir)) {
  console.error(`check-bundle: ${dir} does not exist: run the build first`)
  process.exit(2)
}

const patterns = ["odk_", "BETTER_AUTH_SECRET", "sk_live", "sk_test", "whsec_"]
const apiUrl = (process.env.API_URL ?? "").trim()
if (apiUrl.length >= 8) patterns.push(apiUrl)
const label = (p) => (p === apiUrl ? "the API_URL value" : p)

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name)
    const s = statSync(p)
    if (s.isDirectory()) yield* files(p)
    else if (s.isFile()) yield p
  }
}

const hits = []
for (const file of files(dir)) {
  const text = readFileSync(file, "latin1") // byte-safe for js, maps, json, css and anything else
  for (const p of patterns) if (text.includes(p)) hits.push(`${label(p)} in ${path.relative(dir, file)}`)
}

if (hits.length > 0) {
  console.error("check-bundle: secret or server-only value found in the client bundle:")
  for (const h of hits) console.error(`  - ${h}`)
  process.exit(1)
}
console.log(`check-bundle: clean (${patterns.length} patterns)`)
