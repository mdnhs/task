import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const ROOT = path.resolve(__dirname, "../..")
const run = (args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts/api-types.mjs"), ...args], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }

describe("generated API types (B6 ruling I2)", () => {
  test("package.json wires api:types, api:types:check and test:contract; openapi-typescript is a pinned devDependency and not a runtime dependency", () => {
    expect(pkg.scripts["api:types"]).toMatch(/api-types\.mjs/)
    expect(pkg.scripts["api:types:check"]).toMatch(/api-types\.mjs --check/)
    expect(pkg.scripts["test:contract"]).toMatch(/vitest.*vitest\.contract\.config\.ts/)
    expect(pkg.devDependencies["openapi-typescript"]).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Object.keys(pkg.dependencies)).not.toContain("openapi-typescript")
    expect(Object.keys(pkg.dependencies).filter((d) => /^(hono|@hono|openapi-fetch|better-auth)/.test(d))).toEqual([])
  })

  test("generated types are current: api:types:check passes against the real API document", () => {
    const r = run(["--check"])
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/is current/)
  }, 120_000)

  test("a changed DTO makes the check fail (and says how to fix it)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-types-"))
    const doc = path.join(dir, "openapi.json")
    const dump = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "api/scripts/dump-openapi.ts"), doc], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
    expect(dump.status, dump.stderr).toBe(0)
    expect(run(["--check", "--doc", doc]).status).toBe(0)
    const json = JSON.parse(readFileSync(doc, "utf8")) as { components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> } }
    const name = Object.keys(json.components.schemas).find((k) => /TaskDto|Task$/i.test(k) && json.components.schemas[k].properties) ?? Object.keys(json.components.schemas).find((k) => json.components.schemas[k].properties)!
    json.components.schemas[name].properties!.addedByTest = { type: "string" }
    json.components.schemas[name].required = [...(json.components.schemas[name].required ?? []), "addedByTest"]
    writeFileSync(doc, JSON.stringify(json))
    const r = run(["--check", "--doc", doc])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/stale/i)
    expect(r.stderr).toMatch(/npm run api:types/)
  }, 180_000)

  test("the committed file says it is generated and exposes typed paths (no hand edits)", () => {
    const text = readFileSync(path.join(ROOT, "lib/api/schema.d.ts"), "utf8")
    expect(text).toMatch(/generated/i)
    expect(text).toMatch(/export interface paths/)
    expect(text).toMatch(/"\/v1\/me\/tenant"/)
    expect(text).toMatch(/emailVerified: boolean/)
  })

  test("CI runs the drift check and the contract tests", () => {
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")
    const deploy = readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8")
    expect(ci).toMatch(/npm run api:types:check/)
    expect(ci).toMatch(/npm run test:contract/)
    expect(deploy).toMatch(/npm run api:types:check/) // the deploy gate cannot ship a stale contract either
  })
})
