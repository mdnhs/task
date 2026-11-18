#!/usr/bin/env node
// Fails when a secret was committed (B7 Task 18). No service, no dependency:
//   node scripts/check-secrets.mjs [dir]        default: the repo root (git-tracked and untracked-but-not-ignored files; a plain walk when there is no .git)
// Findings: known token prefixes (Stripe sk_/rk_ live and test keys, whsec_, the API's odk_ keys, GitHub, AWS, Slack, Google, Resend), private key blocks, and a
// high-entropy value (32+ characters) assigned to a secret-like name (secret, token, password, api key, private key, credential).
// Skipped: *.test.* and *.spec.* files, *.example files, lockfiles, binaries, node_modules, .git, .next, and any line carrying `check-secrets:allow <why>`.
// It prints the pattern name, the file and the line number, never the match: a leaked secret must not land in CI logs.
// Exit codes: 0 clean, 1 found, 2 the directory does not exist.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."))
if (!existsSync(root)) {
  console.error(`check-secrets: ${root} does not exist`)
  process.exit(2)
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".superpowers", "test-results", "playwright-report", "coverage"])
const SKIP_FILE = /(\.test\.|\.spec\.|\.example$|(^|\/)package-lock\.json$|\.lock$|\.map$|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp3|mp4|webm|zip|gz|tsbuildinfo)$)/i
const MAX_BYTES = 2_000_000

const PREFIXES = [
  ["Stripe live or restricted key", /\b[sr]k_live_[A-Za-z0-9]{8,}/],
  ["Stripe test key", /\b[sr]k_test_[A-Za-z0-9]{8,}/],
  ["webhook signing secret (whsec_)", /\bwhsec_[A-Za-z0-9]{8,}/],
  ["API key (odk_)", /\bodk_[A-Za-z0-9_-]{16,}/],
  ["Resend key", /\bre_[A-Za-z0-9]{20,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["private key block", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
]
const ASSIGN = /([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|credential)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["'`]?([A-Za-z0-9+/=_-]{32,})/i

function entropy(s) {
  const n = new Map()
  for (const ch of s) n.set(ch, (n.get(ch) ?? 0) + 1)
  let h = 0
  for (const c of n.values()) h -= (c / s.length) * Math.log2(c / s.length)
  return h
}

function* walk(d) {
  for (const name of readdirSync(d)) {
    if (SKIP_DIRS.has(name)) continue
    const p = path.join(d, name)
    const s = statSync(p)
    if (s.isDirectory()) yield* walk(p)
    else if (s.isFile()) yield p
  }
}

function listFiles() {
  if (existsSync(path.join(root, ".git"))) {
    try {
      const out = execFileSync("git", ["ls-files", "-z", "-c", "-o", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      return out.split("\0").filter(Boolean).map((f) => path.join(root, f)).filter((f) => existsSync(f))
    } catch {
      /* no git binary: fall through to the walk */
    }
  }
  return [...walk(root)]
}

const findings = []
for (const file of listFiles()) {
  const rel = path.relative(root, file).split(path.sep).join("/")
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg)) || SKIP_FILE.test(rel)) continue
  let st
  try { st = statSync(file) } catch { continue }
  if (!st.isFile() || st.size > MAX_BYTES) continue
  const buf = readFileSync(file)
  if (buf.includes(0)) continue // binary
  const lines = buf.toString("utf8").split("\n")
  lines.forEach((line, i) => {
    if (line.includes("check-secrets:allow")) return
    for (const [name, re] of PREFIXES) if (re.test(line)) findings.push(`${name} in ${rel}:${i + 1}`)
    const m = ASSIGN.exec(line)
    if (m && new Set(m[2]).size >= 12 && entropy(m[2]) >= 4) findings.push(`high-entropy value for "${m[1].slice(0, 40)}" in ${rel}:${i + 1}`)
  })
}

if (findings.length > 0) {
  console.error("check-secrets: possible committed secret(s):")
  for (const f of findings) console.error(`  - ${f}`)
  console.error("Remove the value and rotate it. A test fixture goes in a *.test.* file, or the line gets `check-secrets:allow <why>`.")
  process.exit(1)
}
console.log("check-secrets: clean")
