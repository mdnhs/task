import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const run = (dir: string) => spawnSync(process.execPath, [path.join(ROOT, "scripts/check-secrets.mjs"), dir], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv })
function tree(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "secrets-"))
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
  return dir
}
// Planted values are assembled at run time, so this test file itself never contains a token-shaped string.
const rand = (n: number) => Array.from({ length: n }, (_, i) => "aB3xK9qZ7mT2vL8nR5wY1cH4jD6fG0sP"[(i * 7 + 3) % 32]).join("")
const planted = {
  stripeLive: "sk_" + "live_" + rand(24),
  stripeTest: "sk_" + "test_" + rand(24),
  whsec: "whsec" + "_" + rand(24),
  odk: "odk" + "_" + rand(24),
  pem: "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
  entropy: "q9Zr3LmX8wBn4TcV7hYd1JfG5sKa2PeU6oIt0NxC",
}

describe("secret scan (B7 Task 18)", () => {
  test("check-secrets passes a clean tree and the repo as is", () => {
    expect(run(tree({ "a.ts": "export const x = 1\n// sk_live is the prefix of a live key\nconst name = 'BETTER_AUTH_SECRET'\n" })).status).toBe(0)
    const r = run(ROOT)
    expect(r.stdout + r.stderr).toMatch(/check-secrets: clean/)
    expect(r.status).toBe(0)
  })

  test.each([
    ["a live Stripe key", planted.stripeLive, "src/billing.ts"],
    ["a test Stripe key", planted.stripeTest, "src/billing.ts"],
    ["a webhook signing secret", planted.whsec, "config.json"],
    ["an API key", planted.odk, "docs/notes.md"],
    ["a private key block", planted.pem, "deploy/key.txt"],
  ])("check-secrets flags a planted %s and never prints it", (_n, value, file) => {
    const r = run(tree({ [file]: `const v = "${value}"\n${value}\n` }))
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toContain(file)
    expect(r.stderr + r.stdout).not.toContain(value.slice(8, 30))
  })

  test("check-secrets flags a high-entropy value assigned to a secret-like name", () => {
    expect(run(tree({ "a.ts": `const apiSecret = "${planted.entropy}"\n` })).status).toBe(1)
    expect(run(tree({ ".env.production": `SOME_TOKEN=${planted.entropy}\n` })).status).toBe(1)
    // low entropy or short values, and long values on non-secret names, are not findings
    expect(run(tree({ "a.ts": `const apiSecret = "${"a".repeat(40)}"\nconst token = "short"\nconst hash = "${planted.entropy}"\n` })).status).toBe(0)
  })

  test("test files, *.example files, lockfiles and lines marked check-secrets:allow are skipped", () => {
    expect(run(tree({ "src/billing.test.ts": `const k = "${planted.stripeLive}"`, "api/.env.example": `KEY=${planted.stripeLive}`, "package-lock.json": `"integrity": "${planted.entropy}", "secret": "${planted.entropy}"`, "a.ts": `const k = "${planted.stripeLive}" // check-secrets:allow fixture\n` })).status).toBe(0)
  })

  test("node_modules and .git are never scanned", () => {
    expect(run(tree({ "node_modules/x/index.js": planted.stripeLive, ".git/config": planted.stripeLive })).status).toBe(0)
  })

  test("a missing directory is exit 2", () => {
    expect(run(path.join(tmpdir(), "does-not-exist-secrets")).status).toBe(2)
  })
})
