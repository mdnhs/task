// Dependency-free smoke runner against the REAL stack (B6 T6.9): web + API + the demo seed. Entry: { path, as?, tenant?, status?, expect?, notExpect?, mock? }.
//   as      a persona key (PERSONAS below). The runner signs that person in through the web's own /api/auth/sign-in/email with SMOKE_PASSWORD, keeps a cookie jar per persona
//           and sends it, plus the active tenant cookie. No `as` = a signed-out request.
//   tenant  a tenant slug (default "northgate", the full demo dataset).
//   mock    true = runs only against a demo deployment (SMOKE_MOCK=1, the web started with ENABLE_MOCK_MODULES=1); false = only against one without it.
// Env: SMOKE_BASE (default http://localhost:3000), SMOKE_PASSWORD (required: the demo seed's SEED_DEMO_PASSWORD), SMOKE_EMAIL_DOMAIN (default demo.example), SMOKE_MOCK.
// LOCAL / demo databases only (a non-localhost SMOKE_BASE needs SMOKE_ALLOW_REMOTE=1): never point it at a real client's deployment. Cases live in scripts/smoke/*.json.
import { readFileSync, readdirSync, existsSync } from "node:fs"

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000"
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && process.env.SMOKE_ALLOW_REMOTE !== "1") {
  console.error(`SMOKE_BASE ${BASE} is not localhost: the smoke signs people in with the demo password. Set SMOKE_ALLOW_REMOTE=1 only for a demo deployment. Nothing is run.`)
  process.exit(2)
}
const DOMAIN = process.env.SMOKE_EMAIL_DOMAIN ?? "demo.example"
const MOCK = process.env.SMOKE_MOCK === "1"
const PASSWORD = process.env.SMOKE_PASSWORD
if (!PASSWORD) {
  console.error("SMOKE_PASSWORD is not set (the demo seed's SEED_DEMO_PASSWORD). Nothing is run.")
  process.exit(2)
}

// The seeded people (api/src/seed/demo) and the role each holds in northgate.
export const PERSONAS = {
  owner: "amara.bello",
  admin: "rhys.edwards",
  ops: "lilianna.novak",
  supervisor: "daniel.okafor",
  hr: "priya.shah",
  auditor: "ibrahim.khan",
  employee: "tomasz.wojcik",
  payroll: "sofia.marin",
}

const dir = new URL("./smoke/", import.meta.url)
const cases = []
if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) cases.push(...JSON.parse(readFileSync(new URL(f, dir), "utf8")).map((c) => ({ ...c, file: f })))

const jars = new Map()
async function jarFor(persona) {
  if (jars.has(persona)) return jars.get(persona)
  const local = PERSONAS[persona]
  if (!local) throw new Error(`unknown persona ${persona}`)
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ email: `${local}@${DOMAIN}`, password: PASSWORD }) })
  if (!res.ok) throw new Error(`sign-in as ${persona} failed: ${res.status}`)
  const jar = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  if (!jar) throw new Error(`sign-in as ${persona} set no cookie`)
  jars.set(persona, jar)
  return jar
}

let failed = 0
let ran = 0
for (const r of cases) {
  if (r.mock === true && !MOCK) continue
  if (r.mock === false && MOCK) continue
  ran++
  const reasons = []
  const label = `${r.as ?? "anon"}${r.tenant ? `@${r.tenant}` : ""} ${r.path}`
  try {
    const headers = {}
    if (r.as) headers.cookie = `${await jarFor(r.as)}; od-tenant=${r.tenant ?? "northgate"}`
    const res = await fetch(BASE + r.path, { headers, redirect: "manual" })
    // The loading skeleton streams first inside a pending Suspense boundary (<!--$?-->...<!--/$-->) with ghost text; the answer is what replaces it.
    const html = (await res.text()).replace(/<!--\$\?-->[\s\S]*?<!--\/\$-->/g, "")
    const want = r.status ?? 200
    if (res.status !== want) reasons.push(`status ${res.status}, expected ${want}`)
    for (const s of r.expect ?? []) if (!html.includes(s)) reasons.push(`missing "${s}"`)
    for (const s of r.notExpect ?? []) if (html.includes(s)) reasons.push(`unexpected "${s}"`)
  } catch (e) {
    reasons.push(`request failed: ${e.message}`)
  }
  if (reasons.length) {
    failed++
    console.log(`FAIL ${label} ${reasons.join("; ")}`)
  } else console.log(`PASS ${label}`)
}
console.log(`${ran - failed}/${ran} passed (${MOCK ? "demo deployment" : "no mock modules"})`)
process.exit(failed ? 1 : 0)
