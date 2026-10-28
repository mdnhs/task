// Dependency-free smoke runner: hits the running dev server for each route in
// smoke-routes.json. Entry: { path, status?, cookies?, expect?, notExpect? }.
import { readFileSync, readdirSync, existsSync } from "node:fs"

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000"
const routes = JSON.parse(readFileSync(new URL("./smoke-routes.json", import.meta.url), "utf8"))
// Per-feature cases live in scripts/smoke/<feature>.json so features don't share one file.
const dir = new URL("./smoke/", import.meta.url)
if (existsSync(dir))
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort())
    routes.push(...JSON.parse(readFileSync(new URL(f, dir), "utf8")))

let failed = 0
for (const r of routes) {
  const reasons = []
  try {
    const headers = {}
    if (r.cookies) headers.cookie = Object.entries(r.cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    const res = await fetch(BASE + r.path, { headers, redirect: "manual" })
    const html = await res.text()
    const want = r.status ?? 200
    if (res.status !== want) reasons.push(`status ${res.status}, expected ${want}`)
    for (const s of r.expect ?? []) if (!html.includes(s)) reasons.push(`missing "${s}"`)
    for (const s of r.notExpect ?? []) if (html.includes(s)) reasons.push(`unexpected "${s}"`)
  } catch (e) {
    reasons.push(`request failed: ${e.message}`)
  }
  if (reasons.length) {
    failed++
    console.log(`FAIL ${r.path} ${reasons.join("; ")}`)
  } else console.log(`PASS ${r.path}`)
}
process.exit(failed ? 1 : 0)
