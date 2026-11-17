import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = path.resolve(__dirname, "..")
const run = (dir: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts/check-bundle.mjs"), dir], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv })
function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-"))
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
  return dir
}

describe("no secret in the client bundle (B6 global constraint)", () => {
  test("a clean bundle passes", () => {
    const r = run(bundle({ "chunks/a.js": "console.log('hello', '/v1/me')", "css/x.css": "a{color:red}" }), { API_URL: "http://api.internal:3001" })
    expect(r.status).toBe(0)
  })

  test.each([
    ["odk_", "const k='odk_abcd1234_xxxx'"],
    ["BETTER_AUTH_SECRET", "process.env.BETTER_AUTH_SECRET"],
    ["sk_live", "const s='sk_live_51Abc'"],
    ["sk_test", "const s='sk_test_51Abc'"],
    ["whsec_", "const s='whsec_abc'"],
  ])("check-bundle.mjs finds %s in any file under the directory, even nested, and fails", (needle, body) => {
    const r = run(bundle({ "chunks/deep/er/b.js": `var a=1;${body};var b=2` }))
    expect(r.status).toBe(1)
    expect(r.stderr + r.stdout).toContain(needle)
    expect(r.stderr + r.stdout).not.toContain("abcd1234") // it names the pattern and the file, never the secret
    expect(r.stderr + r.stdout).not.toContain("51Abc")
  })

  test("the API_URL value is searched for when it is set (and not when it is too short to be meaningful)", () => {
    const dir = bundle({ "chunks/a.js": "fetch('http://api.internal:3001/v1/me')" })
    expect(run(dir, { API_URL: "http://api.internal:3001" }).status).toBe(1)
    expect(run(dir, { API_URL: "" }).status).toBe(0)
    expect(run(dir, { API_URL: "/" }).status).toBe(0)
  })

  test("it also finds a secret in a source map, a json file and a .txt chunk", () => {
    for (const f of ["a.js.map", "manifest.json", "notes.txt"]) expect(run(bundle({ [f]: "whsec_zzz" })).status, f).toBe(1)
  })

  test("a missing directory is an error (exit 2), not a pass: the build must run first", () => {
    expect(run(path.join(tmpdir(), "does-not-exist-bundle")).status).toBe(2)
  })
})
