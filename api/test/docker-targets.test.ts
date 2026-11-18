import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

// Parses api/Dockerfile only (no docker in unit tests). The seed image must be a deliberate, named target that a plain `docker build` can never pick.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const text = readFileSync(resolve(ROOT, "api/Dockerfile"), "utf8")
const instructions = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")

type Stage = { name: string; from: string; lines: string[] }
function stages(): Stage[] {
  const out: Stage[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const m = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (m) out.push({ name: m[2] ?? m[1]!, from: m[1]!, lines: [] })
    else out.at(-1)?.lines.push(line)
  }
  return out
}
const S = stages()
const stage = (n: string) => S.find((s) => s.name === n)
const cmd = (s: Stage) => s.lines.filter((l) => /^CMD\b/i.test(l)).at(-1) ?? null

describe("api/Dockerfile targets", () => {
  test("the stages are deps, a shared base, seed and run, and run is the LAST one (the default target of a plain docker build)", () => {
    expect(S.map((s) => s.name)).toEqual(["deps", "app", "seed", "run"])
    expect(S.at(-1)!.name).toBe("run")
  })

  test("run starts the API server and never seeds", () => {
    const c = cmd(stage("run")!)!
    expect(c).toContain("src/server.ts")
    expect(c).not.toMatch(/seed/i)
    expect(stage("run")!.from).toBe("app")
  })

  test("seed is a separate target whose CMD is the seed script and not the API", () => {
    const s = stage("seed")!
    expect(s.from).toBe("app")
    const c = cmd(s)!
    expect(c).toContain("scripts/seed-demo.ts")
    expect(c).not.toContain("src/server.ts")
    expect(c).toContain("tsx")
  })

  test("nothing in the file switches the opt-in on, sets a password or a database URL (the operator supplies them at run time), and the seed stage is not the base of another stage", () => {
    expect(instructions).not.toMatch(/ALLOW_DEMO_SEED\s*=\s*1/)
    expect(instructions).not.toMatch(/SEED_DEMO_PASSWORD\s*=/)
    expect(instructions).not.toMatch(/DATABASE(_OWNER)?_URL\s*=/)
    expect(S.some((s) => s.from === "seed")).toBe(false)
  })

  test("the shared base has no CMD at all and the seed stage is labelled so an inspect shows what it is", () => {
    expect(cmd(stage("app")!)).toBeNull()
    expect(stage("seed")!.lines.join("\n")).toMatch(/LABEL\s+.*demo-seed/i)
  })

  test("CI and compose files never name the seed target as a default: only an explicit --target/target: seed builds it", () => {
    for (const f of ["docker-compose.dev.yml", "docker-compose.e2e.yml"]) {
      const y = readFileSync(resolve(ROOT, f), "utf8")
      expect(y.includes("api/Dockerfile") ? /target:\s*seed/.test(y) : false, f).toBe(false)
    }
  })
})
